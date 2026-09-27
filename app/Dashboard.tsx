"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  type Db, type Membership, type Plan,
  monthOf, monthLabel, monthStart, money, monthsFor, paidThrough, priceAt, status, cur, toMinor, toMajor, currencySymbol,
  dn, cycleStart, cycleEnd, cycleOf, cycleLabel, fmtDate, fmtRange, per, units, planBackfill,
} from "@/lib/coverage";
import { recordPayment, deletePayment, deleteBatch, deleteAllUnfrozen, freezePayment, clearDemo, backfill } from "./actions";
import { Close, Lock, Plus, Undo } from "./ui";
import Strip, { stripCells } from "./Strip";

const BACK = 3;
const COLS = 12;
const QUICK = [1, 3, 6, 12];

type Row = {
  ms: Membership;
  plan: Plan;
  name: string;
  through: number; // last paid cycle
  due: string; // next payment date
  paid: boolean;
  st: ReturnType<typeof status>;
};

type Win = { a: number; b: number }; // timeline window as day numbers [a, b)

/** Horizontal position inside the month columns, as a CSS length (frac 0..1 across the window). */
const at = (frac: number) =>
  `calc(var(--name-col) + (100% - var(--name-col) - var(--status-col)) * ${Math.min(Math.max(frac, 0), 1)})`;
const frac = (w: Win, iso: string) => (dn(iso) - w.a) / (w.b - w.a);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function Dashboard({ db, today }: { db: Db; today: string }) {
  const now = monthOf(today);
  const start = now - BACK;
  const win: Win = { a: dn(monthStart(start)), b: dn(monthStart(start + COLS)) };
  const todayFrac = frac(win, today);

  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "due">("all");
  const [sort, setSort] = useState<"due" | "latest" | "name">("due");
  const [selected, setSelected] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [fresh, setFresh] = useState<{ id: string; from: number; to: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<"pay" | "backfill">("pay");
  const [bfFrom, setBfFrom] = useState("");
  const [bfTo, setBfTo] = useState(today);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; paymentId: string; batch?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rows = useMemo<Row[]>(() => {
    const names = new Map(db.members.map((m) => [m.id, m.name]));
    return db.memberships
      .map((ms) => {
        const plan = db.plans.find((p) => p.id === ms.planId)!;
        if (!plan) return null;
        const through = paidThrough(ms, db.payments);
        return {
          ms, plan, through,
          due: cycleStart(plan, through + 1),
          name: names.get(ms.memberId) ?? "Unknown",
          paid: db.payments.some((p) => p.membershipId === ms.id),
          st: status(plan, through, today),
        };
      })
      .filter((r): r is Row => !!r);
  }, [db, today]);

  const counts = {
    overdue: rows.filter((r) => r.st.kind === "overdue").length,
    due: rows.filter((r) => r.st.kind === "due").length,
  };
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
  const byDue = (a: Row, b: Row) => a.due.localeCompare(b.due) || byName(a, b);
  const visible = rows
    .filter((r) => (!planFilter || r.plan.id === planFilter) && (statusFilter === "all" || r.st.kind === statusFilter))
    .sort(sort === "name" ? byName : sort === "latest" ? (a, b) => byDue(b, a) : byDue);
  // Phone strips share one start date so a cell lines up across rows.
  const stripFrom = [today, ...visible.map((r) => r.due)].reduce((m, d) => (d < m ? d : m), today);
  const stripFromIso = stripFrom < monthStart(start) ? monthStart(start) : stripFrom;
  // Person search: "Name · Plan" is unique even when a name repeats across plans.
  const label = (r: Row) => `${r.name} · ${r.plan.name}`;

  // Payment preview for the selected member.
  const sel = rows.find((r) => r.ms.id === selected) ?? null;
  const unit = sel ? priceAt(sel.plan, cycleOf(sel.plan, today)) : 0;
  const c = sel ? cur(sel.plan) : "USD";
  // An empty amount means one cycle at the current price.
  const amountCents = amount.trim() ? toMinor(amount, c) : unit;
  const check = sel && mode === "pay" ? monthsFor(amountCents, unit) : null;
  const hasPaid = !!sel && sel.paid;
  const bf = sel && mode === "backfill" && bfTo ? planBackfill(sel.plan, sel.ms, db.payments, hasPaid ? null : bfFrom || null, bfTo) : null;
  // The cycles being previewed on the timeline, whichever mode is open.
  const pv = check?.ok ? { from: sel!.through + 1, to: sel!.through + check.months } : bf?.ok ? { from: bf.from, to: bf.to } : null;
  const after = sel && pv ? status(sel.plan, pv.to, today) : null;

  function select(id: string) {
    setSelected(id);
    const r = rows.find((x) => x.ms.id === id);
    if (r) {
      setWho(label(r));
      setBfFrom(cycleStart(r.plan, r.ms.startCycle));
    }
    setError(null);
    setSheetOpen(true);
    requestAnimationFrame(() => amountRef.current?.focus({ preventScroll: true }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sel || !pv) return;
    const who = sel.name;
    const { from, to: through } = pv;
    const plan = sel.plan;
    const cents = bf?.ok ? bf.cents : amountCents;
    startTransition(async () => {
      const res = mode === "backfill"
        ? await backfill(sel.ms.id, hasPaid ? null : bfFrom || null, bfTo)
        : await recordPayment(sel.ms.id, amountCents, paidOn);
      if (!res.ok) return setError(res.error);
      setAmount("");
      setError(null);
      setSheetOpen(false);
      setFresh({ id: sel.ms.id, from, to: through });
      setTimeout(() => setFresh(null), 1200);
      clearTimeout(toastTimer.current);
      setToast({
        text: `${mode === "backfill" ? `Backfilled ${through - from + 1} ${through === from ? "payment" : "payments"} (${money(cents, c)})` : `Recorded ${money(cents, c)}`} for ${who}. Paid through ${fmtDate(cycleEnd(plan, through))}.`,
        paymentId: res.paymentId,
        batch: mode === "backfill",
      });
      toastTimer.current = setTimeout(() => setToast(null), 8000);
    });
  }

  function undo() {
    if (!toast) return;
    const { paymentId, batch } = toast;
    setToast(null);
    startTransition(async () => { await (batch ? deleteBatch(paymentId) : deletePayment(paymentId)); });
  }

  const plansShown = db.plans.filter((p) => !planFilter || p.id === planFilter);

  return (
    <>
      {db.demo && (
        <div className="demo-bar" role="note">
          <span><strong>Demo data.</strong> These plans and people are made up so you can try things out.</span>
          <form action={clearDemo} onSubmit={(e) => { if (!confirm("Delete all demo plans, people and payments?")) e.preventDefault(); }}><button className="btn">Clear demo data and start fresh</button></form>
        </div>
      )}

      <div className="workspace">
        <main>
          <div className="toolbar">
            <h1>Who&rsquo;s paid through when</h1>
            <div className="chips" role="group" aria-label="Filter by status">
              <button className="chip" aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                Everyone <span className="n">{rows.length}</span>
              </button>
              <button className="chip chip-over" aria-pressed={statusFilter === "overdue"} onClick={() => setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")}>
                <span className="dot" aria-hidden /> Overdue <span className="n">{counts.overdue}</span>
              </button>
              <button className="chip chip-due" aria-pressed={statusFilter === "due"} onClick={() => setStatusFilter(statusFilter === "due" ? "all" : "due")}>
                <span className="dot" aria-hidden /> Due this week <span className="n">{counts.due}</span>
              </button>
            </div>
            <label className="sort">
              <span>Sort</span>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="due">Most overdue first</option>
                <option value="latest">Paid furthest ahead first</option>
                <option value="name">Name</option>
              </select>
            </label>
            {db.plans.length > 1 && (
              <div className="chips" role="group" aria-label="Filter by plan">
                <button className="chip" aria-pressed={!planFilter} onClick={() => setPlanFilter(null)}>All plans</button>
                {db.plans.map((p) => (
                  <button key={p.id} className="chip" aria-pressed={planFilter === p.id} onClick={() => setPlanFilter(planFilter === p.id ? null : p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {db.plans.length === 0 ? (
            <div className="empty">
              <h2>Add your first plan</h2>
              <p>Enter the plan&rsquo;s name, price per person, billing cycle and first billing date, then add the people on it. Their coverage shows up here as a timeline.</p>
              <Link className="btn btn-primary" href="/manage"><Plus /> Add a plan</Link>
            </div>
          ) : (
            <div className="timeline" style={{ ["--cols" as string]: COLS }}>
              <div className="tl-grid tl-head" aria-hidden>
                <div className="name">Member</div>
                {Array.from({ length: COLS }, (_, i) => {
                  const m = start + i;
                  return (
                    <div key={m} className={[m === now && "now", m % 12 === 0 && i > 0 && "yr-start"].filter(Boolean).join(" ") || undefined}>
                      <span className="yr">{m % 12 === 0 || i === 0 ? Math.floor(m / 12) : ""}</span>
                      {monthLabel(m, false)}
                    </div>
                  );
                })}
                <div className="stat">Status</div>
                <div className="today-tag" style={{ left: at(todayFrac) }}>Today</div>
              </div>

              <div className="tl-grid tl-body" role="list" aria-label="Members by plan">
                {plansShown.map((plan) => {
                  const planRows = visible.filter((r) => r.plan.id === plan.id);
                  const all = rows.filter((r) => r.plan.id === plan.id).length;
                  if (!planRows.length && statusFilter !== "all") return null;
                  const nowK = cycleOf(plan, today);
                  const price = priceAt(plan, nowK);
                  const next = plan.prices.find((p) => p.from > nowK);
                  const marks = plan.prices
                    .map((p, i) => ({ p, prev: plan.prices[i - 1], x: frac(win, cycleStart(plan, p.from)) }))
                    .filter(({ prev, x }) => prev && x > 0 && x < 1);
                  const nextX = next ? frac(win, cycleStart(plan, next.from)) : 2;
                  return (
                    <div className="group" key={plan.id} role="listitem">
                      <div className="group-head">
                        <h2>{plan.name}<small>{cycleLabel(plan)}</small></h2>
                        <span className="meta">
                          {money(price, cur(plan))}{per(plan)}
                          {next && <span className={nextX < 1 ? "next inwin" : "next"}> → {money(next.cents, cur(plan))} from {fmtDate(cycleStart(plan, next.from), false)}</span>}
                          {" · "}{all} {all === 1 ? "person" : "people"}
                        </span>
                        {marks.map(({ p, prev, x }) => (
                          <span key={p.from} className="price-mark" style={{ left: at(x) }}>
                            {money(prev.cents, cur(plan))} → {money(p.cents, cur(plan))}
                          </span>
                        ))}
                      </div>
                      {marks.map(({ p, x }) => (
                        <span key={p.from} className="price-line" style={{ left: at(x) }} aria-hidden />
                      ))}
                      {all === 0 && (
                        <p className="group-empty">No one is on this plan yet. <Link href="/manage">Add people to {plan.name}</Link></p>
                      )}
                      <div role="list" style={{ display: "contents" }}>
                        {planRows.map((r) => (
                          <MemberRow
                            key={r.ms.id}
                            r={r}
                            db={db}
                            win={win}
                            today={today}
                            stripFrom={stripFromIso}
                            todayFrac={todayFrac}
                            selected={selected === r.ms.id}
                            pv={selected === r.ms.id ? pv : null}
                            fresh={fresh?.id === r.ms.id ? fresh : null}
                            onSelect={() => select(r.ms.id)}
                            onDeleted={(p) => setToast((t) => (t && (t.paymentId === p.id || t.paymentId === p.batch) ? null : t))}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <span className="today" style={{ left: at(todayFrac) }} aria-hidden />
              </div>
              {visible.length === 0 && rows.length > 0 && (
                <p className="group-empty" style={{ borderBottom: 0 }}>
                  {statusFilter === "overdue" ? "No one is overdue." : statusFilter === "due" ? "No one is due in the next 7 days." : "No one matches this filter."}
                </p>
              )}
            </div>
          )}
        </main>

        <aside className={`panel${sheetOpen ? " open" : ""}`} aria-label="Record payment">
          <form onSubmit={submit} className="panel-form" style={{ display: "grid", gap: "1rem" }}>
            <div className="panel-head">
              <h2>Record payment</h2>
              <button type="button" className="btn btn-quiet close" onClick={() => setSheetOpen(false)} aria-label="Close">
                <Close />
              </button>
            </div>

            <label className="field">
              <span>Who paid</span>
              <input
                className="input"
                list="people-plans"
                value={who}
                placeholder="Type a name"
                autoComplete="off"
                onChange={(e) => {
                  setWho(e.target.value);
                  const r = rows.find((x) => label(x) === e.target.value);
                  setSelected(r ? r.ms.id : null);
                  setError(null);
                }}
              />
              <datalist id="people-plans">
                {[...rows].sort(byName).map((r) => <option key={r.ms.id} value={label(r)} />)}
              </datalist>
            </label>

            {sel && (
              <>
                <p className="hint">
                  {sel.plan.name} costs <b>{money(unit, c)}{per(sel.plan)}</b>{(sel.plan.cycle ?? "monthly") === "monthly" ? `, billed ${cycleLabel(sel.plan).toLowerCase()}` : ""}.{" "}
                  {sel.paid ? `Paid through ${fmtDate(cycleEnd(sel.plan, sel.through))}.` : "No payments yet."}
                </p>
                <div className="modes" role="radiogroup" aria-label="What to record">
                  <button type="button" role="radio" aria-checked={mode === "pay"} onClick={() => { setMode("pay"); setError(null); }}>Payment</button>
                  <button type="button" role="radio" aria-checked={mode === "backfill"} onClick={() => { setMode("backfill"); setError(null); }}>Backfill</button>
                </div>

                {mode === "pay" ? (
                  <>
                    <label className="field">
                      <span>Amount received</span>
                      <span className="money" data-sym={currencySymbol(c)} style={{ ["--sym" as string]: `${currencySymbol(c).length}ch` }}>
                        <input
                          ref={amountRef}
                          className="input"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder={`${toMajor(unit, c)} (1 ${(sel.plan.cycle ?? "monthly") === "monthly" ? "month" : "cycle"})`}
                          value={amount}
                          aria-invalid={check && !check.ok ? true : undefined}
                          aria-describedby="preview"
                          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                        />
                      </span>
                    </label>
                    <div className="quick" aria-label="Quick amounts">
                      {QUICK.map((n) => (
                        <button type="button" key={n} onClick={() => setAmount(String(toMajor(unit * n, c)))}>
                          <b>{units(sel.plan, n, true)}</b> <span>{money(unit * n, c)}</span>
                        </button>
                      ))}
                    </div>
                    <label className="field">
                      <span>Date received</span>
                      <input className="input" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
                    </label>
                  </>
                ) : (
                  <>
                    <p className="hint">Mark past cycles as paid in one go, for example when you start tracking someone who&rsquo;s already been paying you.</p>
                    <label className="field">
                      <span>Coverage starts</span>
                      <input
                        className="input"
                        type="date"
                        value={hasPaid ? cycleStart(sel.plan, sel.through + 1) : bfFrom}
                        disabled={hasPaid}
                        aria-describedby="bf-from-hint"
                        onChange={(e) => setBfFrom(e.target.value)}
                      />
                    </label>
                    <p className="hint" id="bf-from-hint">
                      {hasPaid
                        ? `Continues from their first unpaid cycle, since ${sel.name} already has payments.`
                        : "Their first cycle is the one that includes this date."}
                    </p>
                    <label className="field">
                      <span>Paid through</span>
                      <input className="input" type="date" value={bfTo} onChange={(e) => setBfTo(e.target.value)} aria-describedby="preview" />
                    </label>
                  </>
                )}

                <div id="preview" aria-live="polite">
                  {pv && (() => {
                    const p = sel.plan;
                    const n = pv.to - pv.from + 1;
                    const k0 = Math.max(cycleOf(p, monthStart(start)), Math.min(cycleOf(p, today), pv.from));
                    const startCycle = bf?.ok ? bf.startCycle : sel.ms.startCycle;
                    return (
                      <div className="preview-box">
                        <Strip
                          cells={stripCells(p, k0, startCycle, pv.from - 1, pv.to, today)}
                          labels={[fmtDate(cycleStart(p, k0)), fmtDate(cycleEnd(p, k0 + 11))]}
                        />
                        <dl>
                          <dt>Covers</dt>
                          <dd>{fmtRange(cycleStart(p, pv.from), cycleEnd(p, pv.to))} ({units(p, n)})</dd>
                          {bf?.ok && (
                            <>
                              <dt>Amount</dt>
                              <dd>{money(bf.cents, c)}</dd>
                            </>
                          )}
                          {after?.kind === "overdue" ? (
                            <>
                              <dt>After this</dt>
                              <dd className="over">Still overdue {plural(after.days, "day")}</dd>
                            </>
                          ) : (
                            <>
                              <dt>Next due</dt>
                              <dd>{fmtDate(cycleStart(p, pv.to + 1))}{after?.kind === "due" ? (after.days === 0 ? " (today)" : ` (in ${plural(after.days, "day")})`) : ""}</dd>
                            </>
                          )}
                        </dl>
                      </div>
                    );
                  })()}
                  {check && !check.ok && (
                    <div className="preview-box bad">
                      <span>{money(amountCents, c)} isn&rsquo;t a whole number of cycles at {money(unit, c)}{per(sel.plan)}. Use:</span>
                      <div className="quick">
                        {check.suggestions.map((s) => (
                          <button type="button" key={s} onClick={() => setAmount(String(toMajor(s, c)))}>
                            <b>{money(s, c)}</b> <span>{units(sel.plan, s / unit, true)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {bf && !bf.ok && <div className="preview-box bad"><span>{bf.error}</span></div>}
                </div>

                {error && <p className="err" role="alert">{error}</p>}
                <button className="btn btn-primary" disabled={!pv || pending}>
                  {pending
                    ? "Saving…"
                    : bf?.ok
                      ? `Backfill ${units(sel.plan, bf.cycles)} · ${money(bf.cents, c)}`
                      : check?.ok
                        ? `Record ${money(amountCents, c)} · ${units(sel.plan, check.months)}`
                        : mode === "backfill" ? "Backfill" : "Record payment"}
                </button>
              </>
            )}
            {!sel && db.plans.length > 0 && (
              <p className="hint">Pick a person here or click their row on the timeline. You&rsquo;ll see exactly which dates the payment covers before you save.</p>
            )}
          </form>
        </aside>
      </div>

      {db.plans.length > 0 && !sheetOpen && (
        <button className="btn btn-primary fab" onClick={() => { setSheetOpen(true); }}>
          <Plus /> Record payment
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button className="btn" onClick={undo}><Undo /> Undo</button>
        </div>
      )}
    </>
  );
}

function MemberRow({
  r, db, win, today, stripFrom, todayFrac, selected, pv, fresh, onSelect, onDeleted,
}: {
  r: Row; db: Db; win: Win; today: string; stripFrom: string; todayFrac: number;
  selected: boolean; pv: { from: number; to: number } | null; fresh: { from: number; to: number } | null; onSelect: () => void;
  onDeleted: (payment: { id: string; batch?: string }) => void;
}) {
  const { plan, ms } = r;
  const [busy, startBusy] = useTransition();
  const [histError, setHistError] = useState<string | null>(null);
  const remove = (p: { id: string; cents: number; paidOn: string; batch?: string }) => {
    if (!confirm(`Delete the ${money(p.cents, cur(plan))} payment from ${fmtDate(p.paidOn)}? Later coverage for ${r.name} moves earlier to fill the gap.`)) return;
    startBusy(async () => {
      const res = await deletePayment(p.id);
      setHistError(res.ok ? null : res.error ?? "Couldn't delete that payment.");
      if (res.ok) onDeleted(p);
    });
  };
  const freeze = (p: { id: string; cents: number; paidOn: string }) => {
    if (!confirm(`Freeze the ${money(p.cents, cur(plan))} payment from ${fmtDate(p.paidOn)}? Frozen payments can never be deleted.`)) return;
    startBusy(async () => { await freezePayment(p.id); });
  };
  const removeAll = () => {
    const mine = db.payments.filter((p) => p.membershipId === ms.id);
    const deletable = mine.filter((p) => !p.frozen);
    const frozen = mine.length - deletable.length;
    const msg =
      `Delete ${deletable.length} unfrozen ${deletable.length === 1 ? "payment" : "payments"} for ${r.name} on ${plan.name}?` +
      (frozen ? ` The ${frozen} frozen ${frozen === 1 ? "payment stays" : "payments stay"}.` : "") +
      " This can't be undone.";
    if (!confirm(msg)) return;
    startBusy(async () => {
      await deleteAllUnfrozen(ms.id);
      setHistError(null);
      for (const p of deletable) onDeleted(p);
    });
  };
  const lastAll = Math.max(r.through, pv?.to ?? r.through);
  // What each cycle is on this row: being previewed, already paid, or nothing.
  const kind = (k: number) => (pv && k >= pv.from && k <= pv.to ? "preview" : k >= ms.startCycle && k <= r.through ? "paid" : null);

  // One segment per cycle, placed at its real dates; cycles outside the window are skipped.
  const segs: React.ReactNode[] = [];
  const winStart = new Date(win.a * 86_400_000).toISOString().slice(0, 10);
  for (let k = Math.max(Math.min(ms.startCycle, pv?.from ?? ms.startCycle), cycleOf(plan, winStart)); k <= lastAll; k++) {
    const x0 = frac(win, cycleStart(plan, k));
    if (x0 >= 1) break;
    const kd = kind(k);
    if (!kd) continue;
    const x1 = frac(win, cycleStart(plan, k + 1));
    const isPreview = kd === "preview";
    const cls = ["seg", kd];
    if (kind(k - 1) !== kd) cls.push("first");
    if (kind(k + 1) !== kd) cls.push("last");
    if (!isPreview && x1 > 1) cls.push("cont");
    if (!isPreview && fresh && k >= fresh.from && k <= fresh.to) cls.push("fresh");
    const left = Math.max(x0, 0), right = Math.min(x1, 1);
    segs.push(
      <span
        key={k}
        className={cls.join(" ")}
        style={{
          left: `calc(${left * 100}% + 1px)`,
          width: `calc(${(right - left) * 100}% - 2px)`,
          ...(isPreview ? { ["--i" as string]: k - pv!.from } : {}),
        }}
      />,
    );
  }

  // Unpaid stretch up to today, clipped to the timeline; it may have begun before the first visible month.
  const gapFrom = frac(win, cycleStart(plan, lastAll + 1));
  const gapStart = Math.max(gapFrom, 0);
  const showGap = r.st.kind === "overdue" && gapStart < todayFrac;

  let head: React.ReactNode;
  let sub: string;
  const paidThroughText = `Paid through ${fmtDate(cycleEnd(plan, r.through))}`;
  if (r.st.kind === "overdue") {
    head = <b className="over">Overdue {plural(r.st.days, "day")}</b>;
    sub = r.paid ? paidThroughText : "No payments yet";
  } else if (r.st.kind === "due") {
    head = <b className="due">{r.st.days === 0 ? "Due today" : `Due in ${plural(r.st.days, "day")}`}</b>;
    sub = r.paid ? paidThroughText : `First payment ${fmtDate(r.due, false)}`;
  } else {
    head = <b>{r.paid ? paidThroughText : `Starts ${fmtDate(cycleStart(plan, ms.startCycle), false)}`}</b>;
    sub = `Next due ${fmtDate(r.due, false)}`;
  }

  let covered = ms.startCycle - 1;
  const history = db.payments
    .filter((p) => p.membershipId === ms.id)
    .map((p) => {
      const from = covered + 1;
      covered += p.months;
      return { ...p, from, to: covered };
    })
    .reverse();

  return (
    <>
      <div className="row" role="listitem" aria-selected={selected} onClick={onSelect}>
        <div className="who">
          <button
            type="button"
            className="name-btn"
            aria-expanded={selected}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
          >
            <b>{r.name}</b>
          </button>
          <Strip cells={stripCells(plan, cycleOf(plan, stripFrom), Math.min(ms.startCycle, pv?.from ?? ms.startCycle), pv ? pv.from - 1 : r.through, lastAll, today)} />
        </div>
        <div className="lane" aria-hidden>
          {segs}
          {showGap && (
            <span
              className={gapFrom < 0 ? "gap open" : "gap"}
              style={{ left: `calc(${gapStart * 100}% + 2px)`, width: `calc(${(todayFrac - gapStart) * 100}% - 2px)` }}
            />
          )}
        </div>
        <div className="stat">
          {head}
          <span>{sub}</span>
        </div>
      </div>
      {selected && (
        <div className="history">
          {history.length ? (
            <table>
              <caption className="sr">Payments from {r.name} for {plan.name}</caption>
              <thead><tr><th>Received</th><th>Amount</th><th>Covers</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td>{p.backfill ? <>Backfilled <span style={{ color: "var(--ink-2)" }}>{fmtDate(p.paidOn)}</span></> : fmtDate(p.paidOn)}</td>
                    <td>{money(p.cents, cur(plan))} {!p.backfill && <span style={{ color: "var(--ink-2)" }}>at {money(p.unitCents, cur(plan))}{per(plan)}</span>}</td>
                    <td>{fmtRange(cycleStart(plan, p.from), cycleEnd(plan, p.to))}</td>
                    <td className="pay-actions">
                      {p.frozen ? (
                        <span className="frozen"><Lock /> Frozen</span>
                      ) : (
                        <>
                          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => freeze(p)}>Freeze</button>
                          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => remove(p)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {history.length > 0 && (
            <div className="history-foot">
              <p className="hint" style={{ margin: 0 }}>
                {histError ? <span className="err" role="alert">{histError}</span> : "Freeze a payment once you’ve confirmed it so it can’t be deleted by mistake."}
              </p>
              {history.some((p) => !p.frozen) && (
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={removeAll}>
                  Delete all unfrozen ({history.filter((p) => !p.frozen).length})
                </button>
              )}
            </div>
          )}
          {history.length ? null : (
            <p className="empty-note" style={{ margin: 0 }}>No payments recorded for {r.name} on {plan.name} yet. Coverage starts {fmtDate(cycleStart(plan, ms.startCycle))}.</p>
          )}
        </div>
      )}
    </>
  );
}

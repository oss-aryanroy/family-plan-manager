import { requireMember } from "@/lib/auth";
import { load } from "@/lib/store";
import { today } from "@/lib/today";
import {
  cycleEnd, cycleLabel, cycleOf, cycleStart, daysUntilDue, fmtDate, fmtRange, money, paidThrough, per, priceAt, status, cur,
} from "@/lib/coverage";
import { TopBar } from "../ui";
import Strip, { stripCells } from "../Strip";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function Me() {
  const t = today();
  const db = await load(t);
  const me = await requireMember(db);

  const mine = db.memberships
    .filter((ms) => ms.memberId === me.id)
    .map((ms) => {
      const plan = db.plans.find((p) => p.id === ms.planId);
      if (!plan) return null;
      const through = paidThrough(ms, db.payments);
      let covered = ms.startCycle - 1;
      const history = db.payments
        .filter((p) => p.membershipId === ms.id)
        .map((p) => ({ ...p, from: (covered += p.months) - p.months + 1, to: covered }))
        .reverse();
      return { ms, plan, through, history, st: status(plan, through, t), days: daysUntilDue(plan, through, t) };
    })
    .filter((x) => x !== null)
    .sort((a, b) => a.days - b.days);

  return (
    <>
      <TopBar current="me" member={me.username} />
      <main className="page me">
        <div>
          <h1>Your plans</h1>
          <p className="hint">Signed in as {me.username}. Payments show up here once the plan owner records them.</p>
        </div>

        {mine.length === 0 && <p className="empty-note">You&rsquo;re not on any plans right now.</p>}

        {mine.map(({ ms, plan, through, history, st, days }) => {
          const nowK = cycleOf(plan, t);
          const next = plan.prices.find((p) => p.from > nowK);
          const paid = history.length > 0;
          const due = fmtDate(cycleStart(plan, through + 1));
          const k0 = Math.max(nowK - 3, Math.min(nowK, through + 1));
          return (
            <section key={ms.id} className="cover" aria-labelledby={`p-${ms.id}`}>
              <header>
                <h2 id={`p-${ms.id}`}>{plan.name}</h2>
                <span>{money(priceAt(plan, nowK), cur(plan))}{per(plan)}{(plan.cycle ?? "monthly") === "monthly" ? ` · ${cycleLabel(plan).toLowerCase()}` : ""}</span>
              </header>

              {st.kind === "overdue" ? (
                <p className="cover-status over">
                  Overdue by {plural(st.days, "day")}
                  <span>{paid ? `Your payment was due ${due}. You're paid through ${fmtDate(cycleEnd(plan, through))}.` : `Your first payment was due ${due}. No payments recorded yet.`}</span>
                </p>
              ) : st.kind === "due" ? (
                <p className="cover-status due">
                  {st.days === 0 ? "Due today" : `Due in ${plural(st.days, "day")}`}
                  <span>{paid ? `You're paid through ${fmtDate(cycleEnd(plan, through))}. Next payment due ${due}.` : `Your first payment is due ${due}.`}</span>
                </p>
              ) : !paid ? (
                <p className="cover-status">
                  Starts {fmtDate(cycleStart(plan, ms.startCycle))}
                  <span>Your first payment is due {due}.</span>
                </p>
              ) : (
                <p className="cover-status">
                  Paid through {fmtDate(cycleEnd(plan, through))}
                  <span>Next payment due {due}, {plural(days, "day")} from now.</span>
                </p>
              )}

              <Strip
                cells={stripCells(plan, k0, ms.startCycle, through, through, t)}
                labels={[fmtDate(cycleStart(plan, k0)), fmtDate(cycleEnd(plan, k0 + 11))]}
              />
              <p className="legend" aria-hidden>
                <span><i className="on" /> Paid</span>
                <span><i className="ov" /> Not paid yet</span>
              </p>

              {next && <p className="hint">The price changes to {money(next.cents, cur(plan))}{per(plan)} from {fmtDate(cycleStart(plan, next.from))}.</p>}

              <details>
                <summary>Payment history ({history.length})</summary>
                {history.length ? (
                  <table className="plain">
                    <thead><tr><th>Received</th><th>Amount</th><th>Covers</th></tr></thead>
                    <tbody>
                      {history.map((p) => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.paidOn)}</td>
                          <td>{money(p.cents, cur(plan))}</td>
                          <td>{fmtRange(cycleStart(plan, p.from), cycleEnd(plan, p.to))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="hint">No payments yet. Coverage starts {fmtDate(cycleStart(plan, ms.startCycle))}.</p>
                )}
              </details>
            </section>
          );
        })}
      </main>
    </>
  );
}

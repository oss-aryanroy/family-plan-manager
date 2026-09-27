import { requireOwner } from "@/lib/auth";
import { load } from "@/lib/store";
import { today } from "@/lib/today";
import { money, paidThrough, priceAt, cur, currencySymbol, cycleOf, cycleStart, cycleEnd, cycleLabel, fmtDate, per } from "@/lib/coverage";
import { addPlan, changePrice, deletePlan, addMembership, removeMembership } from "../actions";
import { TopBar, Plus } from "../ui";
import ConfirmButton from "../ConfirmButton";
import LoginControl from "./LoginControl";

export default async function Manage() {
  await requireOwner();
  const t = today();
  const db = await load(t);
  const names = new Map(db.members.map((m) => [m.id, m.name]));
  // Frozen payments per membership: anything holding one can't be deleted.
  const frozenBy = new Map<string, number>();
  for (const p of db.payments) if (p.frozen) frozenBy.set(p.membershipId, (frozenBy.get(p.membershipId) ?? 0) + 1);
  const frozenFor = (msIds: string[]) => msIds.reduce((n, id) => n + (frozenBy.get(id) ?? 0), 0);
  const frozenNote = (n: number) => (n ? `${n} frozen ${n === 1 ? "payment" : "payments"}` : undefined);
  const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
  const currencies = Intl.supportedValuesOf("currency");
  // New plans default to the currency of the most recently added plan.
  const lastCurrency = db.plans.length ? cur(db.plans[db.plans.length - 1]) : "USD";
  const taken = new Set(db.members.map((m) => m.username).filter(Boolean));
  const suggest = (name: string, id: string) => {
    const base = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 20) || "member";
    const pad = base.length < 3 ? base + id.slice(-3) : base;
    let u = pad;
    for (let i = 2; taken.has(u); i++) u = `${pad}${i}`;
    return u;
  };

  return (
    <>
      <TopBar current="manage" />
      <div className="page">
        <h1>Plans &amp; members</h1>

        <section className="section" aria-labelledby="new-plan">
          <h2 id="new-plan">Add a plan</h2>
          <form action={addPlan} className="form-row">
            <label className="field"><span>Plan name</span><input className="input" name="name" required placeholder="e.g. Family streaming" /></label>
            <label className="field"><span>Price per person, per cycle</span>
              <input className="input" name="price" required inputMode="decimal" pattern="\d+(\.\d{1,3})?" placeholder="5" />
            </label>
            <label className="field currency-field"><span>Currency</span>
              <select className="input" name="currency" defaultValue={lastCurrency}>
                {currencies.map((c) => <option key={c} value={c}>{c} · {currencyNames.of(c)}</option>)}
              </select>
            </label>
            <label className="field"><span>Billing cycle</span>
              <select className="input" name="cycle" defaultValue="monthly">
                <option value="monthly">Same date each month</option>
                <option value="30">Every 30 days</option>
                <option value="31">Every 31 days</option>
              </select>
            </label>
            <label className="field"><span>First billing date</span>
              <input className="input" type="date" name="anchor" required defaultValue={t} />
            </label>
            <button className="btn btn-primary"><Plus /> Add plan</button>
          </form>
        </section>

        <p className="hint" style={{ marginTop: "-1.25rem" }}>Everyone on a plan shares its billing dates. The billing cycle and currency can&rsquo;t be changed after a plan is created, because past payments were counted in them.</p>

        {db.plans.map((plan) => {
          const nowK = cycleOf(plan, t);
          const members = db.memberships
            .filter((m) => m.planId === plan.id)
            .map((m) => ({ m, name: names.get(m.memberId) ?? "Unknown", through: paidThrough(m, db.payments) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <section className="plan-block" key={plan.id} aria-labelledby={`plan-${plan.id}`}>
              <header>
                <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
                <span>{money(priceAt(plan, nowK), cur(plan))}{per(plan)}{(plan.cycle ?? "monthly") === "monthly" ? ` · ${cycleLabel(plan)}` : ""} · {cur(plan)}</span>
                <form action={deletePlan}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <ConfirmButton
                    message={`Delete ${plan.name}, everyone on it and all its payments? This can't be undone.`}
                    blocked={frozenNote(frozenFor(db.memberships.filter((m) => m.planId === plan.id).map((m) => m.id)))}
                  >Delete plan</ConfirmButton>
                </form>
              </header>
              <div className="body">
                <div className="prices" aria-label="Price history">
                  {plan.prices.map((p, i) => (
                    <span key={p.from}>{money(p.cents, cur(plan))}{per(plan)} {i === 0 ? "from the start" : `from ${fmtDate(cycleStart(plan, p.from))}`}</span>
                  ))}
                </div>
                <form action={changePrice} className="form-row">
                  <input type="hidden" name="planId" value={plan.id} />
                  <label className="field"><span>New price per cycle</span>
                    <span className="money" data-sym={currencySymbol(cur(plan))} style={{ ["--sym" as string]: `${currencySymbol(cur(plan)).length}ch` }}><input className="input" name="price" required inputMode="decimal" pattern="\d+(\.\d{1,3})?" /></span>
                  </label>
                  <label className="field"><span>Starting from</span><input className="input" type="date" name="from" required defaultValue={cycleStart(plan, nowK + 1)} /></label>
                  <button className="btn">Change price</button>
                </form>
                <p className="hint">The new price starts with the first billing date on or after the date you pick. Payments already recorded keep the price they were made at.</p>

                {members.length > 0 ? (
                  <ul className="members">
                    {members.map(({ m, name, through }) => (
                      <li key={m.id}>
                        <span>{name} <small>· {through >= m.startCycle ? `paid through ${fmtDate(cycleEnd(plan, through))}` : `starts ${fmtDate(cycleStart(plan, m.startCycle))}, nothing paid yet`}</small></span>
                        <form action={removeMembership}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <ConfirmButton message={`Remove ${name} from ${plan.name}? Their payment history on this plan is deleted too.`} blocked={frozenNote(frozenFor([m.id]))}>Remove</ConfirmButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">No one is on this plan yet.</p>
                )}

                <form action={addMembership} className="form-row">
                  <input type="hidden" name="planId" value={plan.id} />
                  <label className="field"><span>Add a person</span>
                    <input className="input" name="name" required list="people" placeholder="Name" autoComplete="off" />
                  </label>
                  <label className="field"><span>Joined on</span><input className="input" type="date" name="start" required defaultValue={t} /></label>
                  <button className="btn"><Plus /> Add to {plan.name}</button>
                </form>
                <p className="hint">They owe from the billing cycle that includes this date (current cycle: {fmtDate(cycleStart(plan, nowK))} – {fmtDate(cycleEnd(plan, nowK))}).</p>
              </div>
            </section>
          );
        })}
        {db.members.length > 0 && (
          <section className="section" aria-labelledby="logins">
            <div>
              <h2 id="logins">People</h2>
              <p className="hint">Each person signs in to see their own coverage. You create the login and a password is generated; they choose their own the first time they sign in. Deleting a person removes their login, their place on every plan and all their payments. People with frozen payments can&rsquo;t be deleted.</p>
            </div>
            <ul className="logins">
              {[...db.members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
                <LoginControl
                  key={m.id}
                  memberId={m.id}
                  name={m.name}
                  username={m.username}
                  hasLogin={!!m.passHash}
                  waiting={!!m.mustChange}
                  suggested={suggest(m.name, m.id)}
                  plans={db.memberships.filter((x) => x.memberId === m.id).length}
                  frozen={frozenFor(db.memberships.filter((x) => x.memberId === m.id).map((x) => x.id))}
                />
              ))}
            </ul>
          </section>
        )}

        <datalist id="people">{db.members.map((m) => <option key={m.id} value={m.name} />)}</datalist>
      </div>
    </>
  );
}

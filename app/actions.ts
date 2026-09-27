"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, signIn, logOut, hashPassword, generatePassword, requireMember, startMemberSession, verifyMemberPassword, OWNER_USERNAME } from "@/lib/auth";
import { load, save } from "@/lib/store";
import { monthsFor, priceAt, money, cur, toMinor, cycleOf, cycleFrom, cycleStart, planBackfill, type Db, type Cycle, type Payment } from "@/lib/coverage";
import { today } from "@/lib/today";

const id = () => crypto.randomUUID().slice(0, 8);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

async function mutate<T>(fn: (db: Db) => T): Promise<T> {
  await requireOwner();
  const db = await load(today());
  const out = fn(db);
  await save(db);
  revalidatePath("/", "layout");
  return out;
}

export async function recordPayment(
  membershipId: string,
  amountCents: number,
  paidOn: string,
): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  return mutate((db) => {
    const ms = db.memberships.find((m) => m.id === membershipId);
    const plan = ms && db.plans.find((p) => p.id === ms.planId);
    if (!ms || !plan) return { ok: false, error: "That member isn't on this plan anymore." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "Enter the date you were paid." };
    const unit = priceAt(plan, cycleOf(plan, today()));
    const r = monthsFor(amountCents, unit);
    if (!r.ok) return { ok: false, error: `${money(amountCents, cur(plan))} isn't a whole number of months at ${money(unit, cur(plan))}/month.` };
    const paymentId = id();
    db.payments.push({ id: paymentId, membershipId, cents: amountCents, unitCents: unit, months: r.months, paidOn });
    return { ok: true, paymentId };
  });
}

/** Owner: delete a payment (undo, or fixing a mistake). Frozen payments can't be deleted. */
export async function deletePayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  return mutate((db) => {
    const p = db.payments.find((x) => x.id === paymentId);
    if (!p) return { ok: false, error: "That payment was already deleted." };
    if (p.frozen) return { ok: false, error: "This payment is frozen and can't be deleted." };
    removePayments(db, [p]);
    return { ok: true };
  });
}

/** Owner: undo a whole backfill (every entry it created that isn't frozen). */
export async function deleteBatch(batch: string): Promise<{ ok: boolean; error?: string }> {
  return mutate((db) => {
    const entries = db.payments.filter((p) => p.batch === batch);
    if (entries.some((p) => p.frozen)) return { ok: false, error: "Part of this backfill is frozen, so it can't be undone." };
    removePayments(db, entries);
    return { ok: true };
  });
}

/** Owner: delete a person with their login, plan memberships and payments. Refused while they have frozen payments. */
export async function deleteMember(memberId: string): Promise<{ ok: boolean; error?: string }> {
  return mutate((db) => {
    const m = db.members.find((x) => x.id === memberId);
    if (!m) return { ok: false, error: "That person was already deleted." };
    const mine = new Set(db.memberships.filter((x) => x.memberId === memberId).map((x) => x.id));
    const frozen = db.payments.filter((p) => p.frozen && mine.has(p.membershipId)).length;
    if (frozen) return { ok: false, error: `${m.name} has ${frozen} frozen ${frozen === 1 ? "payment" : "payments"}, so they can't be deleted.` };
    db.payments = db.payments.filter((p) => !mine.has(p.membershipId));
    db.memberships = db.memberships.filter((x) => x.memberId !== memberId);
    db.members = db.members.filter((x) => x.id !== memberId);
    return { ok: true };
  });
}

/** Owner: delete every payment for one person on one plan, except frozen ones. */
export async function deleteAllUnfrozen(membershipId: string): Promise<{ ok: true; deleted: number }> {
  return mutate((db) => {
    const gone = db.payments.filter((p) => p.membershipId === membershipId && !p.frozen);
    removePayments(db, gone);
    return { ok: true, deleted: gone.length };
  });
}

/** Remove payments; a backfill's moved start date is restored once none of its entries remain. */
function removePayments(db: Db, gone: Payment[]) {
  const ids = new Set(gone.map((p) => p.id));
  db.payments = db.payments.filter((p) => !ids.has(p.id));
  for (const p of gone) {
    if (p.prevStart === undefined) continue;
    const rest = p.batch ? db.payments.find((x) => x.batch === p.batch) : undefined;
    if (rest) rest.prevStart = p.prevStart; // hand the original start to a remaining entry of the same backfill
    else {
      const ms = db.memberships.find((m) => m.id === p.membershipId);
      if (ms) ms.startCycle = p.prevStart;
    }
  }
}

/** Owner: confirm a payment so it can never be deleted. One-way on purpose. */
export async function freezePayment(paymentId: string) {
  await mutate((db) => {
    const p = db.payments.find((x) => x.id === paymentId);
    if (p) p.frozen = true;
  });
}

/** Owner: mark past coverage as paid up to a date (see planBackfill). */
export async function backfill(
  membershipId: string,
  fromDate: string | null,
  throughDate: string,
): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  if (!isDate(throughDate) || (fromDate !== null && !isDate(fromDate))) return { ok: false, error: "Enter valid dates." };
  return mutate((db) => {
    const ms = db.memberships.find((m) => m.id === membershipId);
    const plan = ms && db.plans.find((p) => p.id === ms.planId);
    if (!ms || !plan) return { ok: false, error: "That member isn't on this plan anymore." };
    const r = planBackfill(plan, ms, db.payments, fromDate, throughDate);
    if (!r.ok) return r;
    // One entry per cycle, dated on that cycle's billing date (never in the future), at that cycle's price.
    const batch = id();
    const t = today();
    const prevStart = r.startCycle !== ms.startCycle ? ms.startCycle : undefined;
    ms.startCycle = r.startCycle;
    for (let k = r.from; k <= r.to; k++) {
      const due = cycleStart(plan, k);
      const price = priceAt(plan, k);
      db.payments.push({
        id: id(), membershipId, cents: price, unitCents: price, months: 1,
        paidOn: due < t ? due : t, backfill: true, batch,
        ...(k === r.from && prevStart !== undefined ? { prevStart } : {}),
      });
    }
    return { ok: true, paymentId: batch };
  });
}

export async function addPlan(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const currency = String(form.get("currency") ?? "USD").toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(currency)) return;
  const price = toMinor(String(form.get("price")), currency);
  const cycle = String(form.get("cycle")) as Cycle;
  const anchor = String(form.get("anchor") ?? "");
  if (!name || !(price > 0) || !["monthly", "30", "31"].includes(cycle) || !isDate(anchor)) return;
  await mutate((db) => {
    db.plans.push({ id: id(), name, currency, cycle, anchor, prices: [{ from: -1e6, cents: price }] });
  });
}

export async function changePrice(form: FormData) {
  const date = String(form.get("from"));
  if (!isDate(date)) return;
  await mutate((db) => {
    const plan = db.plans.find((p) => p.id === form.get("planId"));
    if (!plan) return;
    const from = cycleFrom(plan, date); // takes effect at the first cycle starting on or after the date
    const price = toMinor(String(form.get("price")), cur(plan));
    if (!(price > 0)) return;
    plan.prices = [...plan.prices.filter((p) => p.from !== from), { from, cents: price }].sort((a, b) => a.from - b.from);
  });
}

export async function deletePlan(form: FormData) {
  await mutate((db) => {
    const planId = form.get("planId");
    const gone = new Set(db.memberships.filter((m) => m.planId === planId).map((m) => m.id));
    if (db.payments.some((p) => p.frozen && gone.has(p.membershipId))) return; // frozen payments are never deleted
    db.plans = db.plans.filter((p) => p.id !== planId);
    db.memberships = db.memberships.filter((m) => !gone.has(m.id));
    db.payments = db.payments.filter((p) => !gone.has(p.membershipId));
  });
}

export async function addMembership(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const planId = String(form.get("planId") ?? "");
  const date = String(form.get("start"));
  if (!name || !planId || !isDate(date)) return;
  await mutate((db) => {
    const plan = db.plans.find((p) => p.id === planId);
    if (!plan) return;
    const start = cycleOf(plan, date); // the cycle that contains their start date is the first one they owe
    let member = db.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!member) db.members.push((member = { id: id(), name }));
    if (db.memberships.some((m) => m.memberId === member.id && m.planId === planId)) return;
    db.memberships.push({ id: id(), planId, memberId: member.id, startCycle: start });
  });
}

export async function removeMembership(form: FormData) {
  await mutate((db) => {
    const msId = form.get("membershipId");
    const ms = db.memberships.find((m) => m.id === msId);
    if (db.payments.some((p) => p.frozen && p.membershipId === msId)) return; // frozen payments are never deleted
    db.memberships = db.memberships.filter((m) => m.id !== msId);
    db.payments = db.payments.filter((p) => p.membershipId !== msId);
    if (ms && !db.memberships.some((m) => m.memberId === ms.memberId))
      db.members = db.members.filter((m) => m.id !== ms.memberId);
  });
}

export async function clearDemo() {
  await mutate((db) => {
    Object.assign(db, { plans: [], members: [], memberships: [], payments: [], demo: false });
  });
}

export async function login(_: unknown, form: FormData) {
  const username = String(form.get("username") ?? "");
  const next = await signIn(await load(today()), username, String(form.get("password") ?? ""));
  // Forms reset after an action, so hand the username back to refill it.
  if (!next) return { error: "That username and password don't match.", username };
  redirect(next);
}

export async function logout() {
  await logOut();
  redirect("/login");
}

type Issued = { ok: true; username: string; password: string } | { ok: false; error: string };

/** Owner: create a login (or reset its password). Returns the new password once; only its hash is stored. */
export async function issueLogin(memberId: string, username?: string): Promise<Issued> {
  const password = generatePassword();
  return mutate((db): Issued => {
    const m = db.members.find((x) => x.id === memberId);
    if (!m) return { ok: false, error: "That person no longer exists." };
    if (username !== undefined) {
      const u = username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(u)) return { ok: false, error: "Use 3–32 letters, numbers, dots, dashes or underscores." };
      if (u === OWNER_USERNAME || db.members.some((x) => x.id !== m.id && x.username === u))
        return { ok: false, error: `“${u}” is taken. Try another.` };
      m.username = u;
    }
    if (!m.username) return { ok: false, error: "Choose a username first." };
    m.passHash = hashPassword(password);
    m.mustChange = true;
    return { ok: true, username: m.username, password };
  });
}

export async function changePassword(_: unknown, form: FormData) {
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const t = today();
  const db = await load(t);
  const me = await requireMember(db, { allowPasswordChange: true });
  if (!verifyMemberPassword(me, current)) return "Your current password isn't right.";
  if (next.length < 8) return "Choose a new password with at least 8 characters.";
  if (next !== String(form.get("confirm") ?? "")) return "The two new passwords don't match.";
  if (next === current) return "Pick a password different from the one you were given.";
  me.passHash = hashPassword(next);
  me.mustChange = false;
  await save(db);
  await startMemberSession(me); // the old session was signed with the old hash
  redirect("/me");
}

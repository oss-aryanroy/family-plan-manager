export type Cycle = "monthly" | "30" | "31";
// Amounts ("cents") are integers in the plan currency's smallest unit (cents, paise; yen has none).
export type Plan = {
  id: string;
  name: string;
  currency?: string;
  cycle?: Cycle; // default "monthly"
  anchor?: string; // first billing date, YYYY-MM-DD; default the 1st of a month
  prices: { from: number; cents: number }[]; // from = cycle index
};
export type Member = {
  id: string;
  name: string;
  username?: string; // lowercase, unique
  passHash?: string; // server only, never sent to the browser
  mustChange?: boolean; // set when the owner generates or resets the password
};
export type Membership = { id: string; planId: string; memberId: string; startCycle: number };
export type Payment = {
  id: string;
  membershipId: string;
  cents: number;
  unitCents: number;
  months: number; // cycles bought
  paidOn: string; // YYYY-MM-DD
  backfill?: boolean; // recorded in bulk for past coverage
  prevStart?: number; // start cycle before a backfill moved it, so undo can restore it
  frozen?: boolean; // confirmed by the owner: can no longer be deleted
  batch?: string; // entries created together by one backfill
};
export type Db = {
  plans: Plan[];
  members: Member[];
  memberships: Membership[];
  payments: Payment[];
  demo?: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Dates (all UTC day arithmetic on YYYY-MM-DD strings) ──
const DAY = 86_400_000;
/** Day number since 1970-01-01. */
export const dn = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
export const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(dn(iso) + n);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

export const monthOf = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + m - 1;
};
export const monthLabel = (m: number, withYear = true) =>
  MONTHS[m % 12] + (withYear ? ` ${Math.floor(m / 12)}` : "");
export const monthStart = (m: number) => `${Math.floor(m / 12)}-${pad((m % 12) + 1)}-01`;
/** "Dec 14, 2026" (or "Dec 14"). */
export const fmtDate = (iso: string, withYear = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
};
/** "Sep 15 – Dec 14, 2026", or with both years when they differ. */
export const fmtRange = (a: string, b: string) =>
  a === b ? fmtDate(a) : `${fmtDate(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmtDate(b)}`;

// ── Cycles ──
const cycleOfPlan = (plan: Plan): Cycle => plan.cycle ?? "monthly";
const anchorOf = (plan: Plan) => plan.anchor ?? "2000-01-01";
const billingDay = (plan: Plan) => Number(anchorOf(plan).slice(8));

/** First day of cycle k. */
export function cycleStart(plan: Plan, k: number): string {
  const c = cycleOfPlan(plan);
  if (c !== "monthly") return addDays(anchorOf(plan), k * Number(c));
  const y = Math.floor(k / 12), m = ((k % 12) + 12) % 12;
  return `${y}-${pad(m + 1)}-${pad(Math.min(billingDay(plan), daysInMonth(y, m)))}`;
}
/** Last day of cycle k. */
export const cycleEnd = (plan: Plan, k: number) => addDays(cycleStart(plan, k + 1), -1);

/** Index of the cycle that contains `iso`. */
export function cycleOf(plan: Plan, iso: string): number {
  const c = cycleOfPlan(plan);
  if (c !== "monthly") return Math.floor((dn(iso) - dn(anchorOf(plan))) / Number(c));
  const m = monthOf(iso);
  return iso >= cycleStart(plan, m) ? m : m - 1;
}
/** Index of the first cycle starting on or after `iso`. */
export const cycleFrom = (plan: Plan, iso: string) => {
  const k = cycleOf(plan, iso);
  return cycleStart(plan, k) === iso ? k : k + 1;
};

/** "Monthly on the 15th", "Every 30 days". */
export function cycleLabel(plan: Plan) {
  const c = cycleOfPlan(plan);
  if (c !== "monthly") return `Every ${c} days`;
  const d = billingDay(plan);
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `Monthly on the ${d}${suffix}`;
}

/** ISO 4217 code for a plan; plans created before currencies existed are USD. */
export const cur = (plan: Plan) => plan.currency ?? "USD";
const digits = (c: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
export const toMinor = (major: number | string, c = "USD") => Math.round(Number(major) * 10 ** digits(c));
export const toMajor = (minor: number, c = "USD") => minor / 10 ** digits(c);
/** "$5", "$5.50", "₹499", "€12", "¥600", "CA$8": decimals only when needed. */
export function money(minor: number, c = "USD") {
  const d = digits(c);
  const v = minor / 10 ** d;
  return new Intl.NumberFormat("en", {
    style: "currency", currency: c, minimumFractionDigits: Number.isInteger(v) ? 0 : d, maximumFractionDigits: d,
  }).format(v);
}
export const currencySymbol = (c = "USD") =>
  new Intl.NumberFormat("en", { style: "currency", currency: c }).formatToParts(0).find((p) => p.type === "currency")?.value ?? c;

/** Price in effect for cycle k; prices are sorted by `from`. */
export function priceAt(plan: Plan, k: number): number {
  let cents = plan.prices[0].cents;
  for (const p of plan.prices) if (p.from <= k) cents = p.cents;
  return cents;
}

/** Whole cycles an amount buys, or the nearest valid amounts when it doesn't divide evenly. */
export function monthsFor(cents: number, unitCents: number):
  | { ok: true; months: number }
  | { ok: false; suggestions: number[] } {
  if (cents > 0 && cents % unitCents === 0) return { ok: true, months: cents / unitCents };
  const lo = Math.floor(cents / unitCents) * unitCents;
  const hi = lo + unitCents;
  return { ok: false, suggestions: lo > 0 ? [lo, hi] : [hi] };
}

/** Last covered cycle. Payments stack from the start cycle; startCycle - 1 means nothing is paid yet. */
export function paidThrough(ms: Membership, payments: Payment[]): number {
  let months = 0;
  for (const p of payments) if (p.membershipId === ms.id) months += p.months;
  return ms.startCycle - 1 + months;
}

export type Status =
  | { kind: "overdue"; days: number }
  | { kind: "due"; days: number } // due today (0) or within 7 days
  | { kind: "covered"; cyclesLeft: number };

/** Days from `today` until the next payment (the start of cycle through + 1); negative when overdue. */
export const daysUntilDue = (plan: Plan, through: number, today: string) => dn(cycleStart(plan, through + 1)) - dn(today);

export function status(plan: Plan, through: number, today: string): Status {
  const until = daysUntilDue(plan, through, today);
  if (until < 0) return { kind: "overdue", days: -until };
  if (until < 8) return { kind: "due", days: until };
  return { kind: "covered", cyclesLeft: through - cycleOf(plan, today) };
}

/** Price unit: "/month" or "/30 days". */
export const per = (plan: Plan) => ((plan.cycle ?? "monthly") === "monthly" ? "/month" : `/${plan.cycle} days`);
/** "3 months" / "3 mo", or "3 × 30 days" / "3 × 30d" for fixed-length cycles. */
export function units(plan: Plan, n: number, short = false) {
  const c = plan.cycle ?? "monthly";
  if (c === "monthly") return short ? `${n} mo` : `${n} ${n === 1 ? "month" : "months"}`;
  return short ? `${n} × ${c}d` : `${n} × ${c} days`;
}

export type Backfill =
  | { ok: true; startCycle: number; from: number; to: number; cycles: number; cents: number }
  | { ok: false; error: string };

  
export function planBackfill(plan: Plan, ms: Membership, payments: Payment[], fromDate: string | null, toDate: string): Backfill {
  const hasPaid = payments.some((p) => p.membershipId === ms.id);
  const startCycle = !hasPaid && fromDate ? cycleOf(plan, fromDate) : ms.startCycle;
  const from = paidThrough({ ...ms, startCycle }, payments) + 1;
  const to = cycleOf(plan, toDate);
  if (to < from)
    return {
      ok: false,
      error: hasPaid
        ? `Already paid through ${fmtDate(cycleEnd(plan, from - 1))}. Pick a later date.`
        : "The paid-through date is before the start date.",
    };
  const cycles = to - from + 1;
  if (cycles > 600) return { ok: false, error: "That's more than 600 cycles. Check the dates." };
  let cents = 0;
  for (let k = from; k <= to; k++) cents += priceAt(plan, k);
  return { ok: true, startCycle, from, to, cycles, cents };
}

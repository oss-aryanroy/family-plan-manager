import assert from "node:assert/strict";
import {
  cycleEnd, cycleFrom, cycleLabel, cycleOf, cycleStart, fmtDate, fmtRange, monthOf, money, monthsFor,
  paidThrough, priceAt, status, toMajor, toMinor, type Plan,
} from "./coverage.ts";

// Legacy plans: monthly on the 1st, cycle index = calendar month.
// The PRODUCT.md example: $5/mo, $15 paid in September covers Oct–Dec, next due Jan 1.
const legacy: Plan = { id: "p", name: "P", prices: [{ from: 0, cents: 500 }] };
const ms = { id: "a", planId: "p", memberId: "m", startCycle: monthOf("2026-10") };
assert.deepEqual(monthsFor(1500, 500), { ok: true, months: 3 });
const pay = { id: "x", membershipId: "a", cents: 1500, unitCents: 500, months: 3, paidOn: "2026-09-20" };
const through = paidThrough(ms, [pay]);
assert.equal(cycleEnd(legacy, through), "2026-12-31");
assert.equal(fmtDate(cycleStart(legacy, through + 1)), "Jan 1, 2027");
assert.equal(cycleLabel(legacy), "Monthly on the 1st");

// Same date each month, clamped to short months.
const monthly: Plan = { id: "q", name: "Q", cycle: "monthly", anchor: "2026-01-31", prices: [{ from: 0, cents: 100 }] };
assert.equal(cycleStart(monthly, monthOf("2026-02")), "2026-02-28");
assert.equal(cycleStart(monthly, monthOf("2026-03")), "2026-03-31");
assert.equal(cycleEnd(monthly, monthOf("2026-02")), "2026-03-30");
assert.equal(cycleOf(monthly, "2026-03-15"), monthOf("2026-02"));
assert.equal(cycleOf(monthly, "2026-03-31"), monthOf("2026-03"));
assert.equal(cycleLabel({ ...monthly, anchor: "2026-01-22" }), "Monthly on the 22nd");

// Fixed 30-day cycles drift: Sep 15 → Oct 15 → Nov 14.
const d30: Plan = { id: "r", name: "R", cycle: "30", anchor: "2026-09-15", prices: [{ from: 0, cents: 100 }] };
assert.equal(cycleStart(d30, 1), "2026-10-15");
assert.equal(cycleStart(d30, 2), "2026-11-14");
assert.equal(cycleEnd(d30, 0), "2026-10-14");
assert.equal(cycleOf(d30, "2026-10-14"), 0);
assert.equal(cycleOf(d30, "2026-10-15"), 1);
assert.equal(cycleOf(d30, "2026-09-14"), -1);
assert.equal(cycleFrom(d30, "2026-10-15"), 1);
assert.equal(cycleFrom(d30, "2026-10-16"), 2);
const d31: Plan = { ...d30, cycle: "31" };
assert.equal(cycleStart(d31, 2), "2026-11-16");
assert.equal(cycleLabel(d31), "Every 31 days");

// Status is measured in days against the next cycle start.
assert.deepEqual(status(legacy, monthOf("2026-12"), "2027-01-01"), { kind: "due", days: 0 });
assert.deepEqual(status(legacy, monthOf("2026-12"), "2027-01-13"), { kind: "overdue", days: 12 });
assert.deepEqual(status(legacy, monthOf("2026-12"), "2026-12-26"), { kind: "due", days: 6 });
assert.deepEqual(status(legacy, monthOf("2026-12"), "2026-09-27"), { kind: "covered", cyclesLeft: 3 });
assert.deepEqual(status(d30, 0, "2026-10-20"), { kind: "overdue", days: 5 });

// Invalid amounts suggest the nearest whole-cycle amounts.
assert.deepEqual(monthsFor(1200, 500), { ok: false, suggestions: [1000, 1500] });
assert.deepEqual(monthsFor(300, 500), { ok: false, suggestions: [500] });

// Price history.
const priced: Plan = { ...legacy, prices: [{ from: monthOf("2026-01"), cents: 500 }, { from: monthOf("2027-02"), cents: 600 }] };
assert.equal(priceAt(priced, monthOf("2027-01")), 500);
assert.equal(priceAt(priced, monthOf("2027-02")), 600);

// Formatting.
assert.equal(fmtRange("2026-09-15", "2026-12-14"), "Sep 15 – Dec 14, 2026");
assert.equal(fmtRange("2026-12-15", "2027-01-14"), "Dec 15, 2026 – Jan 14, 2027");

// Currencies: smallest units come from Intl, so yen has none.
assert.equal(money(500), "$5");
assert.equal(money(550), "$5.50");
assert.equal(money(49900, "INR"), "₹499");
assert.equal(toMinor("499", "INR"), 49900);
assert.equal(toMinor("600", "JPY"), 600);
assert.equal(money(600, "JPY"), "¥600");
assert.equal(toMajor(1250, "EUR"), 12.5);

// Backfill on the 30-day plan billing from Sep 15: joined Aug 20 (cycle -1 = Aug 16 – Sep 14),
// paid through Nov 20 (cycle 2 = Nov 14 – Dec 13) → 4 cycles.
import { planBackfill } from "./coverage.ts";
const bf = planBackfill(d30, { id: "b", planId: "r", memberId: "m", startCycle: 5 }, [], "2026-08-20", "2026-11-20");
assert.deepEqual(bf, { ok: true, startCycle: -1, from: -1, to: 2, cycles: 4, cents: 400 });
// With payments, the start date is ignored and backfill continues after the last paid cycle.
const paidOne = [{ id: "y", membershipId: "b", cents: 100, unitCents: 100, months: 1, paidOn: "2026-08-15" }];
const bf2 = planBackfill(d30, { id: "b", planId: "r", memberId: "m", startCycle: 0 }, paidOne, "2020-01-01", "2026-11-20");
assert.deepEqual(bf2, { ok: true, startCycle: 0, from: 1, to: 2, cycles: 2, cents: 200 });
assert.equal(planBackfill(d30, { id: "b", planId: "r", memberId: "m", startCycle: 0 }, paidOne, null, "2026-09-01").ok, false);
// Mixed prices are summed per cycle.
const bf3 = planBackfill(priced, { id: "c", planId: "p", memberId: "m", startCycle: monthOf("2027-01") }, [], null, "2027-02-10");
assert.deepEqual(bf3, { ok: true, startCycle: monthOf("2027-01"), from: monthOf("2027-01"), to: monthOf("2027-02"), cycles: 2, cents: 1100 });

console.log("coverage ok");

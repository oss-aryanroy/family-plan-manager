import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { monthOf, type Db } from "./coverage";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "fpm:db";
const FILE = process.env.DATA_FILE || ".data/db.json"; // DATA_FILE lets tests use a throwaway file

async function redis(cmd: string[]) {
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Storage request failed (${res.status})`);
  return (await res.json()).result as string | null;
}

export async function load(today: string): Promise<Db> {
  let raw: string | null = null;
  if (url && token) raw = await redis(["GET", KEY]);
  else raw = await readFile(FILE, "utf8").catch(() => null);
  if (raw) {
    const db: Db = JSON.parse(raw);
    // Memberships saved before date cycles stored `startMonth`; for monthly plans on the 1st it is the same cycle index.
    for (const ms of db.memberships as (Db["memberships"][number] & { startMonth?: number })[])
      if (ms.startCycle === undefined) ms.startCycle = ms.startMonth!;
    return db;
  }
  const db = demo(today);
  await save(db);
  return db;
}

export async function save(db: Db) {
  const raw = JSON.stringify(db);
  if (url && token) await redis(["SET", KEY, raw]);
  else {
    if (process.env.VERCEL) throw new Error("No storage configured: add Upstash Redis to this project.");
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, raw);
  }
}

/** Synthetic starter data so the first run shows every state. The owner can clear it. */
function demo(today: string): Db {
  const now = monthOf(today);
  const plans = [
    { id: "p1", name: "Video streaming", prices: [{ from: now - 14, cents: 500 }, { from: now + 2, cents: 600 }] },
    { id: "p2", name: "Music", prices: [{ from: now - 14, cents: 300 }] },
    { id: "p3", name: "Cloud storage", prices: [{ from: now - 14, cents: 200 }] },
  ];
  const names = ["Ana", "Ben", "Chloe", "Dev", "Esra", "Farid", "Gia", "Hugo", "Ines", "Jonah", "Kemi", "Luca"];
  const members = names.map((name, i) => ({ id: `m${i}`, name }));
  // [member, plan, months paid so far (from a start 8 months back)]
  const rows: [number, number, number][] = [
    [0, 0, 8], [1, 0, 7], [2, 0, 13], [3, 0, 6], [4, 0, 9],
    [5, 1, 8], [0, 1, 11], [6, 1, 7], [7, 1, 16], [8, 1, 8],
    [9, 2, 5], [10, 2, 9], [11, 2, 8], [2, 2, 20],
  ];
  const memberships = rows.map(([m, p], i) => ({ id: `s${i}`, planId: plans[p].id, memberId: `m${m}`, startCycle: now - 8 }));
  const payments = rows.flatMap(([, p, months], i) => {
    const unit = plans[p].prices[0].cents;
    // Mix monthly payers with people who pay in chunks.
    const chunks: number[] = i % 3 === 0 ? [months] : i % 3 === 1 ? Array(months).fill(1) : [Math.ceil(months / 2), Math.floor(months / 2)];
    let next = now - 8; // first month this payment covers
    return chunks.filter(Boolean).map((c, j) => {
      const m = Math.min(next - 1, now); // paid late in the month before, never in the future
      const day = m === now ? Math.min(20 + (i % 7), Number(today.slice(8))) : 20 + (i % 7);
      next += c;
      return {
        id: `y${i}-${j}`,
        membershipId: `s${i}`,
        cents: c * unit,
        unitCents: unit,
        months: c,
        paidOn: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    });
  });
  return { plans, members, memberships, payments, demo: true };
}

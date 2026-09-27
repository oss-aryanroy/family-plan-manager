import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Db, Member } from "./coverage";

// One signed session cookie: "owner.<sig>" or "m:<memberId>.<sig>".
// Member signatures include the password hash, so changing or resetting a password signs that member out everywhere.
const COOKIE = "fpm_session";
const ownerPassword = process.env.OWNER_PASSWORD;
export const OWNER_USERNAME = (process.env.OWNER_USERNAME || "owner").toLowerCase();
const prod = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET || ownerPassword || (prod ? "" : "dev-only-secret");

const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readCookie() {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const dot = raw.lastIndexOf(".");
  return dot < 0 ? null : { who: raw.slice(0, dot), sig: raw.slice(dot + 1) };
}

async function setSession(who: string, proof: string) {
  (await cookies()).set(COOKIE, `${who}.${sign(`${who}:${proof}`)}`, {
    httpOnly: true,
    secure: prod,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
}

export async function logOut() {
  (await cookies()).delete(COOKIE);
}

// ── Passwords ────────────────────────────────
export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}

function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  return !!salt && same(scryptSync(pw, salt, 32).toString("hex"), hash);
}

/** 12 characters without look-alikes (no 0/O, 1/l/I), easy to read out or copy. */
export function generatePassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => abc[randomInt(abc.length)]).join("");
}

// ── Owner ────────────────────────────────────
/** Without OWNER_PASSWORD the owner side is open in local dev only; production refuses. */
export async function isOwner() {
  if (!ownerPassword) return !prod && !(await readCookie())?.who.startsWith("m:");
  const c = await readCookie();
  return !!secret && c?.who === "owner" && same(c.sig, sign(`owner:${ownerPassword}`));
}

export async function requireOwner() {
  await connection(); // always per-request: data and auth must never be prerendered
  if (await isOwner()) return;
  redirect((await readCookie())?.who.startsWith("m:") ? "/me" : "/login");
}

// ── Members ──────────────────────────────────
export async function currentMember(db: Db): Promise<Member | null> {
  const c = await readCookie();
  if (!secret || !c?.who.startsWith("m:")) return null;
  const m = db.members.find((x) => x.id === c.who.slice(2));
  return m?.passHash && same(c.sig, sign(`${c.who}:${m.passHash}`)) ? m : null;
}

export async function requireMember(db: Db, { allowPasswordChange = false } = {}) {
  await connection();
  const m = await currentMember(db);
  if (!m) redirect("/login");
  if (m.mustChange && !allowPasswordChange) redirect("/me/password");
  return m;
}

export const startMemberSession = (m: Member) => setSession(`m:${m.id}`, m.passHash!);
export const verifyMemberPassword = (m: Member, pw: string) => !!m.passHash && checkPassword(pw, m.passHash);

// ── Sign in ──────────────────────────────────
/** Returns where to go next, or null when the username or password is wrong. */
export async function signIn(db: Db, username: string, pw: string): Promise<string | null> {
  const u = username.trim().toLowerCase();
  if (u === OWNER_USERNAME) {
    if (!ownerPassword || !secret || !same(pw, ownerPassword)) return null;
    await setSession("owner", ownerPassword);
    return "/";
  }
  const m = db.members.find((x) => x.username === u);
  if (!m?.passHash || !checkPassword(pw, m.passHash)) return null;
  await startMemberSession(m);
  return m.mustChange ? "/me/password" : "/me";
}

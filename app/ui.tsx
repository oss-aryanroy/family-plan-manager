import Link from "next/link";
import { logout } from "./actions";

const svg = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const Plus = () => <svg {...svg}><path d="M8 3v10M3 8h10" /></svg>;
export const Close = () => <svg {...svg}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Lock = () => <svg {...svg}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>;
export const Undo = () => <svg {...svg}><path d="M5.5 3.5L2.5 6.5l3 3" /><path d="M2.5 6.5h7a3.5 3.5 0 010 7H7" /></svg>;

export function TopBar({ current, member }: { current?: "timeline" | "manage" | "me" | "password"; member?: string }) {
  return (
    <header className="topbar">
      <Link href={member ? "/me" : "/"} className="brand" style={{ color: "inherit", textDecoration: "none" }} aria-label="Family Plan Manager, home">
        <span className="brand-mark" aria-hidden><i /><i /><i /></span>
        <span className="brand-name">Family Plan Manager</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {member ? (
          <>
            <Link href="/me" aria-current={current === "me" ? "page" : undefined}>My plans</Link>
            <Link href="/me/password" aria-current={current === "password" ? "page" : undefined}>Password</Link>
          </>
        ) : (
          <>
            <Link href="/" aria-current={current === "timeline" ? "page" : undefined}>Timeline</Link>
            <Link href="/manage" aria-current={current === "manage" ? "page" : undefined}>Plans</Link>
          </>
        )}
        <form action={logout}><button className="nav-btn">Sign out</button></form>
      </nav>
    </header>
  );
}

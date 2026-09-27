import type { Metadata } from "next";
import Link from "next/link";
import pkg from "@/package.json";
import { cycleEnd, cycleOf, cycleStart, fmtDate, monthOf, type Plan } from "@/lib/coverage";
import { BrandIcon, type Brand } from "./brands";

export const metadata: Metadata = { title: "About · Family Plan Manager" };

const REPO = process.env.NEXT_PUBLIC_REPO_URL;

const CREDITS: { name: string; href: string; license: string; icon: Brand; role: string }[] = [
  { name: "Next.js", href: "https://nextjs.org", license: "MIT", icon: "next", role: "Web framework" },
  { name: "React", href: "https://react.dev", license: "MIT", icon: "react", role: "User interface" },
  { name: "TypeScript", href: "https://www.typescriptlang.org", license: "Apache 2.0", icon: "typescript", role: "Language" },
  { name: "Node.js", href: "https://nodejs.org", license: "MIT", icon: "node", role: "Runtime" },
  { name: "pnpm", href: "https://pnpm.io", license: "MIT", icon: "pnpm", role: "Package manager" },
  { name: "Simple Icons", href: "https://simpleicons.org", license: "CC0 1.0", icon: "simpleicons", role: "The logos on this page" },
];

// Made-up example plan for the illustration: billed monthly on the 15th.
const EXAMPLE_PLAN: Plan = { id: "example", name: "Example", cycle: "monthly", anchor: "2026-01-15", prices: [{ from: 0, cents: 0 }] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function About() {
  // Static page: this is when the site was last built.
  const built = new Date().toISOString().slice(0, 10);
  const updated = fmtDate(built);

  // Example around the build date: two cycles back, the current one, paid two cycles ahead.
  const nowK = cycleOf(EXAMPLE_PLAN, built);
  const through = nowK + 2;
  const cycles = Array.from({ length: 12 }, (_, i) => nowK - 2 + i);

  return (
    <main className="about-page">
      <nav className="about-nav" aria-label="About page">
        <Link href="/login" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="brand-mark" aria-hidden><i /><i /><i /></span>
          Family Plan Manager
        </Link>
        <Link href="/login" className="about-back">Back to sign in</Link>
      </nav>

      <article>
        <header className="about-intro">
          <h1>About Family Plan Manager</h1>
          <p>
            A small app for anyone who runs a shared subscription and collects money from the people on it.
            Instead of tracking what someone owes, it tracks how far ahead they&rsquo;ve paid. Every payment turns into
            covered dates, so everyone can see when their next payment is due.
          </p>
          <figure className="about-example">
            <div className="ex-grid" role="img" aria-label={`Example: paid through ${fmtDate(cycleEnd(EXAMPLE_PLAN, through))}. The next payment is due ${fmtDate(cycleStart(EXAMPLE_PLAN, through + 1))}.`}>
              {cycles.map((k) => {
                const start = cycleStart(EXAMPLE_PLAN, k);
                const m = monthOf(start);
                return (
                  <div key={k} className={`ex-cell${k === nowK ? " now" : ""}`}>
                    <span className="ex-today">{k === nowK ? "Today" : ""}</span>
                    <i className={k <= through ? "on" : ""} />
                    <small>{MONTHS[m % 12]}<b>{m % 12 === 0 || k === cycles[0] ? Math.floor(m / 12) : "\u00a0"}</b></small>
                  </div>
                );
              })}
            </div>
            <figcaption>
              <strong>Paid through {fmtDate(cycleEnd(EXAMPLE_PLAN, through), false)}</strong>, so the next payment is due{" "}
              {fmtDate(cycleStart(EXAMPLE_PLAN, through + 1), false)}.
            </figcaption>
            <p className="ex-legend">
              <span><i className="on" /> Paid</span>
              <span><i /> Not paid yet</span>
              <span>Each block is one billing cycle, here the 15th to the 14th.</span>
            </p>
          </figure>
        </header>

        <section aria-labelledby="data">
          <h2 id="data">Your data</h2>
          <ul className="about-facts">
            <li><b>What&rsquo;s stored.</b> Names, usernames, the plans each person is on, prices, and the payments the plan owner records.</li>
            <li><b>Passwords.</b> Never stored as typed. Only a scrambled (hashed) version is kept, so nobody can read them, the plan owner included.</li>
            <li><b>Where it lives.</b> Each copy of the app is run by a plan owner, and the data sits in storage they control.</li>
            <li><b>Who sees what.</b> The plan owner can see everyone. Members only see their own plans and payments.</li>
            <li><b>Cookies.</b> One, to keep you signed in. No analytics, tracking or advertising.</li>
          </ul>
        </section>

        {REPO && (
          <section aria-labelledby="code">
            <h2 id="code">The code</h2>
            <p>
              The source code is on GitHub. Run your own copy for your plans: it fits on{" "}
              <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="inline-brand">
                <BrandIcon name="vercel" />Vercel
              </a>
              &rsquo;s free Hobby plan.
            </p>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="btn github-btn">
              <BrandIcon name="github" /> View on GitHub
            </a>
          </section>
        )}

        <section aria-labelledby="credits">
          <h2 id="credits">Built with</h2>
          <p>Family Plan Manager stands on these open-source projects. Thank you to everyone who makes them.</p>
          <ul className="credits">
            {CREDITS.map((c) => (
              <li key={c.name}>
                <BrandIcon name={c.icon} />
                <span>
                  <a href={c.href} target="_blank" rel="noopener noreferrer">{c.name}</a>
                  <small>{c.role}</small>
                </span>
                <span className="license">{c.license}</span>
              </li>
            ))}
          </ul>
        </section>
      </article>

      <footer className="about-foot">
        <span>Version {pkg.version} · Updated {updated}</span>
        <Link href="/login">Back to sign in</Link>
      </footer>
    </main>
  );
}

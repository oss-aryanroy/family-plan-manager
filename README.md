<div align="center">
  <img src="app/icon.svg" alt="Family Plan Manager logo" width="88" height="88" />

  <h1>Family Plan Manager</h1>

  <p>Keep track of who's paid for their spot on your shared subscriptions, and until when.</p>

  <p>
    <a href="#getting-started">Getting started</a> ·
    <a href="#deploying">Deploying</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

---

## What it does

If you run a family plan (Spotify, Netflix, cloud storage, anything with seats) and friends or family pay you for their spot, this is for you.

Most tools track what someone *owes*. Family Plan Manager tracks how far ahead someone has *paid*. Someone sends you ₹300 for a ₹100 plan and it works out that they're covered for three billing cycles, shows the exact dates, and tells you when they're next due.

- **A timeline of everyone's coverage**, with overdue people flagged in red
- **Your billing cycle, your way**: same date every month, or every 30 or 31 days
- **Any currency per plan**: one plan in INR, another in USD
- **Backfill** past months when you start tracking someone who's been paying for a while
- **Freeze** confirmed payments so they can't be deleted by accident
- **Member logins**, so people can check their own status without messaging you

## How to use it

1. **Sign in as the owner** and add a plan: its name, price per person, currency, billing cycle and first billing date.
2. **Add people** to the plan, with the date they joined.
3. **Record payments** as they come in. Leave the amount empty for a single cycle, or type any amount and it's split into whole cycles for you.
4. **Create logins** for the people on your plans (Plans → People). They get a one-time password and choose their own the first time they sign in.

That's it. The timeline shows who's covered, who's due this week and who's behind.

## Getting started

You'll need [Node.js](https://nodejs.org) 20 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env.local   # then fill it in
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Locally, your data is saved to `.data/db.json`, and the first run fills it with demo data you can clear with one click.

### Settings

| Variable | What it's for |
| --- | --- |
| `OWNER_USERNAME` | Your sign-in name. Defaults to `owner`. |
| `OWNER_PASSWORD` | Your password. Required in production. Wrap it in single quotes if it contains `#` or `$`. |
| `SESSION_SECRET` | Signs sign-in sessions. Generate one with `openssl rand -hex 32`. |
| `OWNER_TZ` | Your time zone, like `Asia/Kolkata`, so "today" matches your calendar. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis storage. Set automatically on Vercel. |
| `NEXT_PUBLIC_REPO_URL` | Optional. Your GitHub repository, linked from the sign-in page's About section. |

## Deploying

The app is built for [Vercel](https://vercel.com) and fits on the free Hobby plan.

1. Import the repository into Vercel.
2. Add [Upstash Redis](https://vercel.com/marketplace/upstash) from the Vercel Marketplace. It sets the storage variables for you.
3. Add `OWNER_PASSWORD`, `SESSION_SECRET` and `OWNER_TZ` under **Settings → Environment Variables**.
4. Deploy.

## Built with

[Next.js](https://nextjs.org) · [React](https://react.dev) · [TypeScript](https://www.typescriptlang.org) · [Upstash Redis](https://upstash.com) · [Vercel](https://vercel.com)

## Contributing

Contributions are welcome, whether it's a bug report, an idea or a pull request.

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep it small and focused.
3. Run the checks:
   ```bash
   pnpm test           # billing-cycle and money math
   npx tsc --noEmit    # types
   pnpm build          # production build
   ```
4. Open a pull request describing what changed and why. Screenshots help for anything visual.

A few things worth knowing before you dive in:

- The billing and coverage math lives in [`lib/coverage.ts`](lib/coverage.ts). If you touch it, add a case to [`lib/coverage.test.ts`](lib/coverage.test.ts).
- New screens should look and behave like the existing ones: the same colours, type and components.
- Plain CSS, no UI library. Reach for what's already in [`app/globals.css`](app/globals.css) before adding anything new.

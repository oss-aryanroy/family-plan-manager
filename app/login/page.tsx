"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "../actions";

export default function Login() {
  const [state, action, pending] = useActionState(login, null);
  const error = state?.error;
  return (
    <main className="login">
      <div className="login-stack">
        <form action={action}>
          <div className="brand">
            <span className="brand-mark" aria-hidden><i /><i /><i /></span>
            Family Plan Manager
          </div>
          <h1>Sign in</h1>
          <label className="field">
            <span>Username</span>
            <input className="input" name="username" defaultValue={state?.username} key={state?.username} required autoFocus={!state} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" name="password" required autoComplete="current-password" autoFocus={!!state} aria-invalid={error ? true : undefined} />
          </label>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          <p className="hint">Don&rsquo;t have a login? Ask the person who runs your plan to create one for you.</p>
        </form>
        <Link href="/about" className="about-link">About this app</Link>

      </div>
    </main>
  );
}

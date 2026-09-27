"use client";

import { useState, useTransition } from "react";
import { issueLogin, deleteMember } from "../actions";

type Props = {
  memberId: string; name: string; username?: string; hasLogin: boolean; suggested: string; waiting: boolean;
  plans: number; frozen: number;
};

export default function LoginControl({ memberId, name, username, hasLogin, suggested, waiting, plans, frozen }: Props) {
  const [value, setValue] = useState(username ?? suggested);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function issue(withUsername: boolean) {
    if (hasLogin && !confirm(`Reset ${name}'s password? Their current password stops working right away.`)) return;
    start(async () => {
      const r = await issueLogin(memberId, withUsername ? value : undefined);
      if (!r.ok) return setError(r.error);
      setError(null);
      setCopied(false);
      setIssued({ username: r.username, password: r.password });
    });
  }

  function remove() {
    const where = plans ? ` from ${plans === 1 ? "their plan" : `all ${plans} of their plans`}, with all their payments` : "";
    if (!confirm(`Delete ${name}${hasLogin ? " and their login" : ""}? This removes them${where}. This can't be undone.`)) return;
    start(async () => {
      const r = await deleteMember(memberId);
      if (!r.ok) setError(r.error ?? "Couldn't delete this person.");
    });
  }

  async function copy() {
    if (!issued) return;
    const text = `Family Plan Manager\nSign in at ${location.origin}/login\nUsername: ${issued.username}\nPassword: ${issued.password}\nYou'll choose your own password the first time you sign in.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the details and copy them yourself.");
    }
  }

  return (
    <li className="login-row">
      <div className="login-who">
        <b>{name}</b>
        <small>
          {hasLogin ? <>@{username} · {waiting ? "hasn’t signed in and changed their password yet" : "signed in and set their own password"}</> : "No login yet"}
        </small>
      </div>
      {hasLogin ? (
        <button className="btn" onClick={() => issue(false)} disabled={pending}>{pending ? "Resetting…" : "Reset password"}</button>
      ) : (
        <form className="login-create" onSubmit={(e) => { e.preventDefault(); issue(true); }}>
          <label className="field">
            <span className="sr">Username for {name}</span>
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoCapitalize="none" spellCheck={false} aria-invalid={error ? true : undefined} />
          </label>
          <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create login"}</button>
        </form>
      )}
      {frozen > 0 ? (
        <span className="blocked">
          <small>{frozen} frozen {frozen === 1 ? "payment" : "payments"}</small>
          <button className="btn btn-quiet" disabled>Delete person</button>
        </span>
      ) : (
        <button className="btn btn-quiet" onClick={remove} disabled={pending}>Delete person</button>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      {issued && (
        <div className="issued" role="status">
          <p>Send these to {name}. The password is shown only this once.</p>
          <dl>
            <dt>Username</dt><dd>{issued.username}</dd>
            <dt>Password</dt><dd><code>{issued.password}</code></dd>
          </dl>
          <div className="issued-actions">
            <button className="btn btn-primary" onClick={copy}>{copied ? "Copied" : "Copy sign-in details"}</button>
            <button className="btn btn-quiet" onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      )}
    </li>
  );
}

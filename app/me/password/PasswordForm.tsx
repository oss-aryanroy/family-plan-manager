"use client";

import { useActionState } from "react";
import { changePassword } from "../../actions";

export default function PasswordForm({ first, username }: { first: boolean; username: string }) {
  const [error, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="password-form">
      <h1>{first ? "Choose your own password" : "Change password"}</h1>
      {first && <p className="hint">You signed in with a password you were given. Replace it with one only you know before you continue.</p>}
      <input type="text" name="username" value={username} autoComplete="username" readOnly hidden />
      <label className="field">
        <span>{first ? "Password you were given" : "Current password"}</span>
        <input className="input" type="password" name="current" required autoComplete="current-password" />
      </label>
      <label className="field">
        <span>New password</span>
        <input className="input" type="password" name="next" required minLength={8} autoComplete="new-password" aria-describedby="pw-hint" />
      </label>
      <p className="hint" id="pw-hint">At least 8 characters.</p>
      <label className="field">
        <span>New password again</span>
        <input className="input" type="password" name="confirm" required minLength={8} autoComplete="new-password" />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
    </form>
  );
}

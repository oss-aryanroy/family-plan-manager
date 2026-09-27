"use client";

/** A form submit button that asks first. `blocked` disables it and says why. */
export default function ConfirmButton({ message, blocked, children }: { message: string; blocked?: string; children: React.ReactNode }) {
  if (blocked)
    return (
      <span className="blocked">
        <small>{blocked}</small>
        <button className="btn btn-quiet" disabled>{children}</button>
      </span>
    );
  return (
    <button className="btn btn-quiet" onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

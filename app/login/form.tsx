"use client";
import { useActionState } from "react";
import { login } from "@/dashboard/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="next" value={next} />
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }} className="ink2">
        Password
        <input className="input" type="password" name="password" autoComplete="current-password" autoFocus required />
      </label>
      {state?.error && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{state.error}</span>}
      <button className="btn primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

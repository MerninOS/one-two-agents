"use client";
import { useActionState } from "react";
import { signIn } from "@/dashboard/authActions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  if (state?.sent) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <span style={{ fontWeight: 650, fontSize: 15 }}>Check your email</span>
        <span className="ink2" style={{ fontSize: 13 }}>If {state.sent} is a member here, a sign-in link is on its way. It works once and expires in an hour.</span>
        <span className="muted" style={{ fontSize: 12 }}>Nothing after a few minutes? Check spam, or ask an owner to add you on Settings &gt; People.</span>
      </div>
    );
  }
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="next" value={next} />
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }} className="ink2">
        Email
        <input className="input" type="email" name="email" autoComplete="email" autoFocus required />
      </label>
      {state?.error && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{state.error}</span>}
      <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}

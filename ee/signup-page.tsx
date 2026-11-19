// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// /signup (the SignupPage slot): invite-only. A code, the business's name, your name and your email;
// then the usual sign-in link by email.
import { SignInCard } from "@/app/login/card";
import { signUp } from "./signup-actions";
import { PLAN } from "./plan-rules";
import { SIGNUP_CLOSED, adminOrgId } from "./admin";

export function SignupPage({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  if (query.sent) {
    return (
      <SignInCard>
        <span className="ink2" style={{ fontSize: 14 }}>Your business is ready. We emailed a sign-in link to {query.sent.slice(0, 200)}. Open it on this device to start.</span>
      </SignInCard>
    );
  }
  if (!adminOrgId()) {
    return (
      <SignInCard>
        <span className="ink2" style={{ fontSize: 14 }}>{SIGNUP_CLOSED} Already have an account? <a href="/login">Sign in</a>.</span>
      </SignInCard>
    );
  }
  const field = (name: string, label: string, type = "text", auto?: string) => (
    <label className="stack" style={{ gap: 4, fontSize: 13 }}>
      <span className="ink2">{label}</span>
      <input name={name} type={type} required autoComplete={auto} className="input" />
    </label>
  );
  return (
    <SignInCard>
      <form action={signUp} className="stack" style={{ gap: 12 }}>
        {query.problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.problem.slice(0, 200)}</span>}
        <span className="ink2" style={{ fontSize: 13 }}>Sign-up is by invitation for now. {PLAN.trialDays} days free, then ${PLAN.baseUsd} a month with you included, plus ${PLAN.seatUsd} for each teammate.</span>
        {field("code", "Sign-up code", "text", "off")}
        {field("business", "Your business’s name", "text", "organization")}
        {field("ownerName", "Your name", "text", "name")}
        {field("email", "Your email", "email", "email")}
        <button className="btn primary">Start my free trial</button>
        <span className="muted" style={{ fontSize: 12 }}>Every agent starts off duty, and nothing is sent, paid or posted without your tap. Already have an account? <a href="/login">Sign in</a>.</span>
      </form>
    </SignInCard>
  );
}

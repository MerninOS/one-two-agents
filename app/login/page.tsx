import { LoginForm } from "./form";
import { safeNext } from "@/core/roles";
import { SignInCard } from "./card";
import { googleSignInOn } from "@/core/db";

export const metadata = { title: "Sign in · Control Room" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; problem?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const google = await googleSignInOn();
  return (
    <SignInCard>
      {sp.problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{String(sp.problem).slice(0, 200)}</span>}
      {google && (
        <>
          <a className="btn" href={`/auth/google?next=${encodeURIComponent(next)}`} style={{ justifyContent: "center" }}>Sign in with Google</a>
          <span className="muted" style={{ fontSize: 12, textAlign: "center" }}>or</span>
        </>
      )}
      <LoginForm next={next} />
    </SignInCard>
  );
}

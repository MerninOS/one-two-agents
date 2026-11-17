import { LoginForm } from "./form";
import { safeNext } from "@/core/roles";
import { SignInCard } from "./card";

export const metadata = { title: "Sign in · Control Room" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; problem?: string }> }) {
  const sp = await searchParams;
  return (
    <SignInCard>
      {sp.problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{String(sp.problem).slice(0, 200)}</span>}
      <LoginForm next={safeNext(sp.next)} />
    </SignInCard>
  );
}

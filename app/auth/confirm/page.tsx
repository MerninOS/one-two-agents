import { SignInCard } from "@/app/login/card";
import { confirmSignIn } from "@/dashboard/authActions";
import { safeNext } from "@/core/roles";

export const metadata = { title: "Sign in · Control Room" };

// The link in the sign-in email opens this page. Signing in takes a tap, so a mail scanner that
// opens links can't use up the one-time code (docs/tenancy.md, slice 2).
export default async function Confirm({ searchParams }: { searchParams: Promise<{ token_hash?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <SignInCard>
      <form action={confirmSignIn} className="stack" style={{ gap: 12 }}>
        <input type="hidden" name="token_hash" value={String(sp.token_hash ?? "")} />
        <input type="hidden" name="next" value={safeNext(sp.next)} />
        <span className="ink2" style={{ fontSize: 13 }}>One tap and you’re in.</span>
        <button className="btn primary">Sign in to the Control Room</button>
      </form>
    </SignInCard>
  );
}

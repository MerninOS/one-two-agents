import { redirect } from "next/navigation";
import { SignInCard } from "@/app/login/card";
import { pickBusiness } from "@/dashboard/authActions";
import { pickList } from "@/dashboard/signin";
import { safeNext } from "@/core/roles";

export const metadata = { title: "Pick a business · Control Room" };

// After a sign-in, a person who is a member of more than one business picks which one to open
// (docs/tenancy.md, slice 8.1). The list comes from a short-lived signed cookie the sign-in set.
export default async function Pick({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const list = await pickList();
  if (!list.length) redirect(`/login?problem=${encodeURIComponent("That sign-in has expired. Ask for a new link.")}`);
  return (
    <SignInCard>
      <span style={{ fontWeight: 650, fontSize: 15 }}>Which business?</span>
      <div className="stack" style={{ gap: 8 }}>
        {list.map((b) => (
          <form key={b.memberId} action={pickBusiness}>
            <input type="hidden" name="member" value={b.memberId} />
            <input type="hidden" name="next" value={safeNext(sp.next)} />
            <button className="btn" style={{ width: "100%", justifyContent: "space-between" }}>
              <span>{b.orgName}</span><span className="muted" style={{ fontSize: 12 }}>{b.role}</span>
            </button>
          </form>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 12 }}>To switch later, sign out and sign in again.</span>
    </SignInCard>
  );
}

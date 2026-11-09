import { LoginForm } from "./form";

export const metadata = { title: "Sign in · Control Room" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next ?? "/";
  return (
    <div className="login">
      <div className="card" style={{ width: 380, maxWidth: "100%", padding: 28, gap: 18, borderRadius: 24 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="brand-mark">12</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17 }}>One Two</span><span className="muted" style={{ fontSize: 12 }}>Mission control</span></span>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}

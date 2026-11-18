// The card the sign-in pages sit in.
export function SignInCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="card" style={{ width: 380, maxWidth: "100%", padding: 28, gap: 18, borderRadius: 24 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="brand-mark">OP</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17 }}>OPERATOR</span><span className="muted" style={{ fontSize: 12 }}>Mission control</span></span>
        </div>
        {children}
      </div>
    </div>
  );
}

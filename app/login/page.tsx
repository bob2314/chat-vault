import { redirect } from "next/navigation";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { getSessionUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero" style={{ marginBottom: 20 }}>
          <div className="badge-row"><span className="badge">Clerk auth</span></div>
          <h1>Login to your vault</h1>
          <p>Use Clerk sign-in/sign-up to access your personal vault workspace.</p>
        </section>
        <div className="card narrow-card">
          <div className="section-title">
            <div>
              <h2>Authentication</h2>
              <p className="meta">Choose an option to continue.</p>
            </div>
          </div>
          {hasClerkKey ? (
            <div className="button-row" style={{ marginTop: 14 }}>
              <SignInButton>
                <button className="button primary" type="button">Sign in</button>
              </SignInButton>
              <SignUpButton>
                <button className="button secondary" type="button">Sign up</button>
              </SignUpButton>
            </div>
          ) : (
            <p className="meta status-error" style={{ marginTop: 14 }}>
              Clerk is installed, but `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

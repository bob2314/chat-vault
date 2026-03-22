import "./globals.css";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export const metadata = {
  title: "Chat Vault",
  description: "Search and organize imported AI chat history."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <html lang="en">
      <body>
        {hasClerkKey ? (
          <ClerkProvider>
            <header className="topbar">
              <div className="container topbar-inner">
                <Link href="/" className="brand">Chat Vault</Link>
                <nav className="nav-row">
                  <SignedOut>
                    <SignInButton>
                      <button className="button secondary small" type="button">Sign in</button>
                    </SignInButton>
                    <SignUpButton>
                      <button className="button secondary small" type="button">Sign up</button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <Link href="/dashboard" className="button secondary small">Dashboard</Link>
                    <UserButton />
                  </SignedIn>
                </nav>
              </div>
            </header>
            {children}
          </ClerkProvider>
        ) : (
          <>
            <header className="topbar">
              <div className="container topbar-inner">
                <Link href="/" className="brand">Chat Vault</Link>
                <nav className="nav-row">
                  <Link href="/login" className="button secondary small">Login</Link>
                </nav>
              </div>
            </header>
            {children}
          </>
        )}
      </body>
    </html>
  );
}

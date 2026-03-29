import "./globals.css";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { ThemeSwitcher } from "@/components/theme-switcher";

export const metadata = {
  title: "Chat Vault",
  description: "A personal chat memory vault: import ChatGPT data and rediscover AI conversations with tags, saved searches, and dashboard insights."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <html lang="en" data-theme="graphite" data-density="slim">
      <body>
        {hasClerkKey ? (
          <ClerkProvider>
            <header className="topbar">
              <div className="container topbar-inner">
                <Link href="/" className="brand">Chat Vault</Link>
                <nav className="nav-row">
                  <SignedOut>
                    <ThemeSwitcher />
                    <SignInButton>
                      <button className="button secondary small" type="button">Sign in</button>
                    </SignInButton>
                    <SignUpButton>
                      <button className="button secondary small" type="button">Sign up</button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <ThemeSwitcher />
                    <Link href="/dashboard" className="button secondary small topbar-link">Dashboard</Link>
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
                  <ThemeSwitcher />
                  <Link href="/login" className="button secondary small topbar-link">Login</Link>
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

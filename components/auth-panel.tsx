"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("Bob");
  const [email, setEmail] = useState("bob@example.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Authentication failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Authentication failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card narrow-card">
      <div className="section-title">
        <div>
          <h2>{mode === "login" ? "Login" : "Create local demo account"}</h2>
          <p className="meta">Simple local auth so the POC has real per-user isolation instead of hand-wavy bullshit.</p>
        </div>
      </div>
      <form className="grid" style={{ gap: 12 }} onSubmit={handleSubmit}>
        {mode === "signup" ? (
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" autoComplete="name" />
        ) : null}
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" />
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        <div className="button-row">
          <button className="button primary" type="submit" disabled={submitting}>
            {submitting ? "Working..." : mode === "login" ? "Login" : "Create account"}
          </button>
          <button className="button secondary" type="button" disabled={submitting} onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Need an account?" : "Back to login"}
          </button>
        </div>
        {error ? <p className="meta error-text">{error}</p> : null}
      </form>
    </div>
  );
}

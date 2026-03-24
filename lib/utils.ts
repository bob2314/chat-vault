import crypto from "node:crypto";
import type { SessionUser } from "@/types";

export function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => `${value ?? ""}`.trim().toLowerCase()).filter(Boolean))];
}

export function tokenize(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function clampSnippet(input: string, max = 220) {
  const clean = input.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}…`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

export function hashPassword(password: string) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function signSession(user: SessionUser, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      user,
      issuedAt: Date.now()
    }),
    "utf8"
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySession(token: string, secret: string) {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
      return null;
    }

    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    if (expected !== signature) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      user?: SessionUser;
      issuedAt?: number;
    };

    if (!decoded.user?.id || !decoded.user?.email || !decoded.user?.name || !decoded.issuedAt) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

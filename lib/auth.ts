import { auth } from "@clerk/nextjs/server";
import type { SessionUser } from "@/types";

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) return null;

    const email =
      (typeof sessionClaims?.email === "string" && sessionClaims.email) ||
      (typeof sessionClaims?.["email_address"] === "string" && sessionClaims["email_address"]) ||
      `${userId}@clerk.local`;
    const name =
      (typeof sessionClaims?.full_name === "string" && sessionClaims.full_name) ||
      (typeof sessionClaims?.name === "string" && sessionClaims.name) ||
      "Clerk User";

    return { id: userId, email, name };
  } catch {
    return null;
  }
}

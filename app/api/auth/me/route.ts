import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (user) {
    await ensureUserRecord(user);
  }
  return NextResponse.json({ user });
}

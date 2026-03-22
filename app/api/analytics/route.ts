import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getAnalytics } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  return NextResponse.json(await getAnalytics(user.id));
}

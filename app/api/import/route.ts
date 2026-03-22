import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, importConversationsForUser } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureUserRecord(user);
    const payload = await request.json();
    const result = await importConversationsForUser(user.id, payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}

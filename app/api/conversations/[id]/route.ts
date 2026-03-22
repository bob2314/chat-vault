import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getConversation } from "@/lib/db";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  const conversation = await getConversation(user.id, params.id);
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(conversation);
}

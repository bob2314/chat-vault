import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, searchConversationsForUser } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const tag = searchParams.get("tag");
  const topic = searchParams.get("topic");
  const data = await searchConversationsForUser({ userId: user.id, query: q, tag, topic });
  return NextResponse.json(data);
}

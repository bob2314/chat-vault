import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, searchConversationsForUser } from "@/lib/db";

function normalizeTopicFilter(topic: string | null) {
  if (!topic) return topic;
  const trimmed = topic.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().startsWith("topic:")
    ? trimmed.slice("topic:".length).trim()
    : trimmed;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const tag = searchParams.get("tag");
  const topic = normalizeTopicFilter(searchParams.get("topic"));
  const data = await searchConversationsForUser({ userId: user.id, query: q, tag, topic });
  return NextResponse.json(data);
}

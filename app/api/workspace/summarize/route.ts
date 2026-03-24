import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getConversation } from "@/lib/db";

const schema = z.object({
  conversationIds: z.array(z.string().min(1)).min(2).max(8)
});

function summarizeConversations(items: Array<Awaited<ReturnType<typeof getConversation>>>) {
  const conversations = items.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const topicCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const points: string[] = [];

  for (const conversation of conversations) {
    for (const topic of conversation.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    for (const tag of conversation.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const decisionLike = conversation.messages
      .filter((message) => /(decide|decision|plan|should|recommend|next step|we will|i will)/i.test(message.content))
      .slice(-1)[0];
    if (decisionLike) {
      const preview = decisionLike.content.replace(/\s+/g, " ").trim().slice(0, 180);
      points.push(`${conversation.title}: ${preview}${preview.length >= 180 ? "..." : ""}`);
    }
  }

  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([topic]) => topic);
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);

  const overview = [
    `You reviewed ${conversations.length} conversations.`,
    topTopics.length > 0 ? `Recurring topics: ${topTopics.join(", ")}.` : null,
    topTags.length > 0 ? `Common tags: ${topTags.join(", ")}.` : null
  ].filter(Boolean).join(" ");

  return {
    summary: overview,
    keyPoints: points.slice(0, 6),
    sources: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title
    }))
  };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);

  try {
    const payload = schema.parse(await request.json());
    const conversations = await Promise.all(payload.conversationIds.map((id) => getConversation(user.id, id)));
    const present = conversations.filter(Boolean);
    if (present.length < 2) {
      return NextResponse.json({ error: "Need at least two valid conversations to summarize." }, { status: 400 });
    }
    return NextResponse.json(summarizeConversations(present));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not summarize workspace." },
      { status: 400 }
    );
  }
}

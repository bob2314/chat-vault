import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, recordSearchClick } from "@/lib/db";

const schema = z.object({
  conversationId: z.string().min(1),
  query: z.string().optional().nullable(),
  tag: z.string().optional().nullable(),
  topic: z.string().optional().nullable(),
  rankPosition: z.number().int().positive().max(200).optional().nullable()
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);

  try {
    const body = await request.json();
    const parsed = schema.parse(body);
    await recordSearchClick(user.id, parsed);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid click payload." },
      { status: 400 }
    );
  }
}

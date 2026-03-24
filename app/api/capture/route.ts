import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, importConversationsForUser, recordCaptureEvent } from "@/lib/db";
import { sha256 } from "@/lib/utils";

const messageSchema = z.object({
  external_id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  created_at: z.string().optional()
});

const captureSchema = z.object({
  source: z.enum(["chatgpt-bookmarklet", "chatgpt-extension"]),
  source_url: z.string().url().optional(),
  captured_at: z.string(),
  parser_version: z.string().default("bookmarklet-v1"),
  conversation: z.object({
    external_id: z.string().optional(),
    title: z.string().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
    messages: z.array(messageSchema).min(1)
  })
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);

  let rawPayload: unknown = null;
  try {
    rawPayload = await request.json();
    const parsed = captureSchema.parse(rawPayload);

    const normalizedPayload = {
      conversations: [
        {
          id: parsed.conversation.external_id,
          title: parsed.conversation.title,
          createdAt: parsed.conversation.created_at,
          updatedAt: parsed.conversation.updated_at,
          messages: parsed.conversation.messages.map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: message.created_at ?? null
          }))
        }
      ]
    };

    const contentHash = sha256(
      JSON.stringify({
        source: parsed.source,
        source_url: parsed.source_url ?? null,
        conversation: normalizedPayload.conversations[0]
      })
    );

    const importResult = await importConversationsForUser(user.id, normalizedPayload, {
      source: "gpt_sync"
    });

    const status =
      importResult.created > 0
        ? "saved"
        : importResult.updated > 0
          ? "updated"
          : importResult.skipped > 0
            ? "skipped"
            : "error";

    await recordCaptureEvent(user.id, {
      source: parsed.source,
      sourceUrl: parsed.source_url ?? null,
      parserVersion: parsed.parser_version,
      capturedAt: parsed.captured_at,
      processedAt: new Date().toISOString(),
      conversationExternalId: parsed.conversation.external_id ?? null,
      contentHash,
      status,
      rawPayload,
      normalizedPayload,
      resultSummary: importResult
    });

    return NextResponse.json({
      ok: true,
      status,
      ...importResult
    });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid capture payload." : error instanceof Error ? error.message : "Capture failed.";

    const fallbackConversationExternalId =
      typeof rawPayload === "object" &&
      rawPayload &&
      typeof (rawPayload as { conversation?: { external_id?: unknown } }).conversation?.external_id === "string"
        ? (rawPayload as { conversation: { external_id: string } }).conversation.external_id
        : null;

    await recordCaptureEvent(user.id, {
      source: "chatgpt-bookmarklet",
      sourceUrl:
        typeof rawPayload === "object" && rawPayload && typeof (rawPayload as { source_url?: unknown }).source_url === "string"
          ? (rawPayload as { source_url: string }).source_url
          : null,
      parserVersion:
        typeof rawPayload === "object" && rawPayload && typeof (rawPayload as { parser_version?: unknown }).parser_version === "string"
          ? (rawPayload as { parser_version: string }).parser_version
          : "unknown",
      capturedAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
      conversationExternalId: fallbackConversationExternalId,
      contentHash: sha256(JSON.stringify(rawPayload ?? {})),
      status: error instanceof z.ZodError ? "rejected" : "error",
      rawPayload,
      resultSummary: { error: message }
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

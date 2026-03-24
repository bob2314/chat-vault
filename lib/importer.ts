import AdmZip from "adm-zip";
import type { ImportPayload, ImportedConversation, ImportedMessage, Role } from "@/types";
import { inferTopics } from "@/lib/topic-rules";
import { slugify, uniqueStrings } from "@/lib/utils";

function titleFromMessages(messages: ImportedMessage[]) {
  const firstUser = messages.find((message) => message.role === "user")?.content ?? "Untitled conversation";
  return firstUser.slice(0, 80).replace(/\s+/g, " ").trim() || "Untitled conversation";
}

function normalizeMessages(messages: ImportedMessage[]) {
  return messages
    .map((message) => ({
      role: (message.role || "user") as Role,
      content: `${message.content ?? ""}`.trim(),
      createdAt: message.createdAt ?? null
    }))
    .filter((message) => message.content.length > 0);
}

function nativePayload(payload: unknown): ImportPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const maybe = payload as { conversations?: ImportedConversation[] };
  if (!Array.isArray(maybe.conversations)) return null;
  return { conversations: maybe.conversations };
}

function extractTextParts(part: unknown): string[] {
  if (typeof part === "string") return [part];
  if (Array.isArray(part)) return part.flatMap(extractTextParts);
  if (!part || typeof part !== "object") return [];

  const maybe = part as { text?: string; content?: unknown; parts?: unknown[] };
  return [maybe.text, maybe.content].flatMap(extractTextParts).concat((maybe.parts ?? []).flatMap(extractTextParts));
}

function roleFromAuthor(author: unknown): Role {
  const role = typeof author === "string" ? author : (author as { role?: string })?.role;
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function chatGptExportPayload(payload: unknown): ImportPayload | null {
  if (!Array.isArray(payload)) return null;

  const conversations = payload
    .map((conversation, index) => {
      if (!conversation || typeof conversation !== "object") return null;
      const raw = conversation as {
        id?: string;
        title?: string;
        create_time?: number;
        update_time?: number;
        mapping?: Record<string, { message?: { author?: { role?: string } | string; content?: { parts?: unknown[]; text?: string } | string; create_time?: number } }>;
      };

      const messages = Object.values(raw.mapping ?? {})
        .map((node) => {
          const message = node?.message;
          if (!message) return null;
          const text = extractTextParts(message.content).join("\n").trim();
          if (!text) return null;
          return {
            role: roleFromAuthor(message.author),
            content: text,
            createdAt: message.create_time ? new Date(message.create_time * 1000).toISOString() : undefined
          } satisfies ImportedMessage;
        })
        .filter(Boolean) as ImportedMessage[];

      if (messages.length === 0) return null;

      return {
        id: raw.id || `chatgpt-${index + 1}`,
        title: raw.title || titleFromMessages(messages),
        createdAt: raw.create_time ? new Date(raw.create_time * 1000).toISOString() : undefined,
        updatedAt: raw.update_time ? new Date(raw.update_time * 1000).toISOString() : undefined,
        messages
      } satisfies ImportedConversation;
    })
    .filter(Boolean) as ImportedConversation[];

  return conversations.length ? { conversations } : null;
}

export function normalizePayload(payload: unknown): ImportPayload {
  const parsed = nativePayload(payload) ?? chatGptExportPayload(payload);
  if (!parsed) {
    throw new Error("Unsupported import format. Use the sample JSON shape or a ChatGPT export conversations.json array.");
  }

  const conversations = parsed.conversations.map((conversation, index) => {
    const messages = normalizeMessages(conversation.messages || []);
    if (messages.length === 0) {
      throw new Error(`Conversation at index ${index} is missing usable messages.`);
    }

    const fullText = messages.map((message) => message.content).join("\n\n");
    const topics = uniqueStrings([...(conversation.topics ?? []), ...inferTopics(fullText)]);
    const tags = uniqueStrings(conversation.tags ?? []);
    const title = conversation.title?.trim() || titleFromMessages(messages);
    const id = conversation.id?.trim() || `${slugify(title)}-${index + 1}`;
    const createdAt = conversation.createdAt ?? messages[0]?.createdAt ?? new Date().toISOString();
    const updatedAt = conversation.updatedAt ?? messages.at(-1)?.createdAt ?? createdAt;

    return {
      id,
      title,
      createdAt,
      updatedAt,
      tags,
      topics,
      messages
    } satisfies ImportedConversation;
  });

  return { conversations };
}

export function normalizePayloadFromUpload(input: { fileName: string; buffer: Buffer }): ImportPayload {
  const lowerName = input.fileName.toLowerCase();
  const isZip = lowerName.endsWith(".zip") || input.buffer.subarray(0, 2).toString("hex") === "504b";

  if (!isZip) {
    const text = input.buffer.toString("utf8");
    return normalizePayload(JSON.parse(text));
  }

  const zip = new AdmZip(input.buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const conversationEntries = entries
    .filter((entry) => {
      const lower = entry.entryName.toLowerCase();
      const base = lower.split("/").at(-1) || lower;
      return /^conversations(?:-\d+)?\.json$/.test(base);
    })
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  if (conversationEntries.length === 0) {
    throw new Error("Could not find conversations JSON files in ZIP export.");
  }

  const combinedConversations: unknown[] = [];
  for (const entry of conversationEntries) {
    const jsonText = entry.getData().toString("utf8");
    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed)) {
      combinedConversations.push(...parsed);
      continue;
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { conversations?: unknown[] }).conversations)) {
      combinedConversations.push(...(parsed as { conversations: unknown[] }).conversations);
    }
  }

  if (combinedConversations.length === 0) {
    throw new Error("Conversations JSON files were found, but no conversations could be parsed.");
  }

  return normalizePayload(combinedConversations);
}

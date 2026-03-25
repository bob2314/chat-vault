type MessageWindow = {
  id: string | number;
  role: string;
  content: string;
};

export type ConversationChunk = {
  chunkIndex: number;
  startMessageId: string | number | null;
  endMessageId: string | number | null;
  text: string;
};

type ChunkOptions = {
  minWindowSize?: number;
  maxWindowSize?: number;
  overlap?: number;
};

export function chunkConversationMessages(messages: MessageWindow[], options?: ChunkOptions): ConversationChunk[] {
  const minWindowSize = Math.max(2, options?.minWindowSize ?? 3);
  const maxWindowSize = Math.max(minWindowSize, options?.maxWindowSize ?? 6);
  const overlap = Math.max(1, Math.min(maxWindowSize - 1, options?.overlap ?? 2));
  const normalized = messages
    .map((message) => ({
      id: message.id,
      role: message.role || "user",
      content: `${message.content ?? ""}`.trim()
    }))
    .filter((message) => message.content.length > 0);

  if (normalized.length === 0) return [];

  const chunks: ConversationChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const remaining = normalized.length - start;
    const windowSize = Math.min(maxWindowSize, Math.max(minWindowSize, remaining));
    const slice = normalized.slice(start, start + windowSize);
    const text = slice.map((message) => `[${message.role}] ${message.content}`).join("\n");

    chunks.push({
      chunkIndex,
      startMessageId: slice[0]?.id ?? null,
      endMessageId: slice.at(-1)?.id ?? null,
      text
    });

    chunkIndex += 1;
    if (start + windowSize >= normalized.length) break;
    start += Math.max(1, windowSize - overlap);
  }

  return chunks;
}

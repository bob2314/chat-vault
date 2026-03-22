import type { SearchParams, SearchResponse } from "@/types";

export interface SearchProvider {
  getName(): string;
  upsertConversationIndex(input: {
    userId: string;
    conversationId: string;
    title: string;
    fullText: string;
    tags: string[];
    topics: string[];
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }): void | Promise<void>;
  deleteConversationIndex(userId: string, conversationId: string): void | Promise<void>;
  search(params: SearchParams): SearchResponse | Promise<SearchResponse>;
}

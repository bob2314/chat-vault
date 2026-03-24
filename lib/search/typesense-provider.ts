import Typesense, { Client } from "typesense";
import { PostgresSearchProvider } from "@/lib/search/postgres-provider";
import type { SearchProvider } from "@/lib/search/provider";
import { scoreConversation } from "@/lib/search/ranking";
import type { SearchParams, SearchResponse } from "@/types";
import { SqliteSearchProvider } from "@/lib/search/sqlite-provider";

const fallback =
  (process.env.DB_PROVIDER || "sqlite").toLowerCase() === "postgres"
    ? new PostgresSearchProvider()
    : new SqliteSearchProvider();

export class TypesenseSearchProvider implements SearchProvider {
  private client: Client;
  private collection = "chat_conversations";

  constructor() {
    this.client = new Typesense.Client({
      nodes: [
        {
          host: process.env.TYPESENSE_HOST || "localhost",
          port: Number(process.env.TYPESENSE_PORT || "8108"),
          protocol: (process.env.TYPESENSE_PROTOCOL as "http" | "https") || "http"
        }
      ],
      apiKey: process.env.TYPESENSE_API_KEY || "xyz",
      connectionTimeoutSeconds: 2
    });
  }

  getName() {
    return "typesense";
  }

  async ensureCollection() {
    try {
      await this.client.collections(this.collection).retrieve();
    } catch {
      await this.client.collections().create({
        name: this.collection,
        fields: [
          { name: "id", type: "string" },
          { name: "userId", type: "string", facet: true },
          { name: "conversationId", type: "string" },
          { name: "title", type: "string" },
          { name: "fullText", type: "string" },
          { name: "tags", type: "string[]", facet: true },
          { name: "topics", type: "string[]", facet: true },
          { name: "createdAt", type: "int64" },
          { name: "updatedAt", type: "int64", sort: true },
          { name: "messageCount", type: "int32" }
        ],
        default_sorting_field: "updatedAt"
      });
    }
  }

  async upsertConversationIndex(input: {
    userId: string;
    conversationId: string;
    title: string;
    fullText: string;
    tags: string[];
    topics: string[];
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }) {
    await this.ensureCollection();
    await this.client.collections(this.collection).documents().upsert({
      id: `${input.userId}:${input.conversationId}`,
      userId: input.userId,
      conversationId: input.conversationId,
      title: input.title,
      fullText: input.fullText,
      tags: input.tags,
      topics: input.topics,
      createdAt: Date.parse(input.createdAt),
      updatedAt: Date.parse(input.updatedAt),
      messageCount: input.messageCount
    });
  }

  async deleteConversationIndex(userId: string, conversationId: string) {
    await this.ensureCollection();
    try {
      await this.client.collections(this.collection).documents(`${userId}:${conversationId}`).delete();
    } catch {
      // ignore missing docs in the POC
    }
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    try {
      await this.ensureCollection();
      const filters = [`userId:=${params.userId}`];
      if (params.tag) filters.push(`tags:=${params.tag}`);
      if (params.topic) filters.push(`topics:=${params.topic}`);
      const response = await this.client.collections(this.collection).documents().search({
        q: params.query || "*",
        query_by: "title,fullText,tags,topics",
        filter_by: filters.join(" && "),
        per_page: 50,
        prefix: true,
        typo_tokens_threshold: 1,
        highlight_full_fields: "fullText"
      });

      return {
        total: response.found || 0,
        query: params.query,
        tag: params.tag ?? null,
        topic: params.topic ?? null,
        results: (response.hits || []).map((hit) => {
          const doc = hit.document as Record<string, any>;
          const updatedAt = new Date(doc.updatedAt).toISOString();
          const ranked = scoreConversation({
            query: params.query,
            title: String(doc.title || ""),
            fullText: String(doc.fullText || ""),
            tags: Array.isArray(doc.tags) ? doc.tags : [],
            topics: Array.isArray(doc.topics) ? doc.topics : [],
            updatedAt,
            activeTag: params.tag,
            activeTopic: params.topic
          });
          return {
            id: doc.conversationId,
            title: doc.title,
            snippet: String(hit.highlights?.[0]?.snippet || doc.fullText || "").slice(0, 260),
            tags: doc.tags || [],
            topics: doc.topics || [],
            bestMessageId: null,
            matchFields: ranked.matchFields,
            createdAt: new Date(doc.createdAt).toISOString(),
            updatedAt,
            score: ranked.score + Number(hit.text_match || 0),
            matchSignals: ranked.signals,
            messageCount: doc.messageCount || 0
          };
        })
      };
    } catch {
      return fallback.search(params);
    }
  }
}

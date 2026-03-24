import type { ConversationSearchResult, SearchResponse } from "@/types";
import type { SemanticChunkHit } from "@/lib/retrieval/semantic";

export function classifyQueryIntent(query: string) {
  const trimmed = query.trim();
  const hasQuotes = /["']/.test(trimmed);
  const hasDigits = /\d/.test(trimmed);
  const hasModelLikeToken = /\b[a-z]+\d+|\d+[a-z]+|[a-z]+-[a-z0-9]+\b/i.test(trimmed);
  const tokenCount = trimmed.split(/\s+/).filter(Boolean).length;
  const exactLike = hasQuotes || hasDigits || hasModelLikeToken || tokenCount <= 3;

  if (exactLike) {
    return { keywordWeight: 0.75, semanticWeight: 0.1 };
  }

  if (tokenCount >= 8) {
    return { keywordWeight: 0.4, semanticWeight: 0.4 };
  }

  return { keywordWeight: 0.55, semanticWeight: 0.25 };
}

export function mergeHybridResults(input: {
  keyword: SearchResponse;
  semantic: SemanticChunkHit[];
  query: string;
}): ConversationSearchResult[] {
  const weights = classifyQueryIntent(input.query);
  const byConversation = new Map<string, ConversationSearchResult>();

  for (const result of input.keyword.results) {
    byConversation.set(result.id, {
      ...result,
      score: result.score * weights.keywordWeight
    });
  }

  for (const hit of input.semantic) {
    const existing = byConversation.get(hit.conversationId);
    if (!existing) continue;
    const semanticScore = Math.max(0, Math.min(1, hit.similarity)) * weights.semanticWeight;
    existing.score += semanticScore;
    if (!existing.matchSignals.includes("semantic chunk")) {
      existing.matchSignals.push("semantic chunk");
    }
  }

  return [...byConversation.values()].sort((a, b) => b.score - a.score);
}

import { tokenize, uniqueStrings } from "@/lib/utils";

type RankingInput = {
  query: string;
  title: string;
  fullText: string;
  tags: string[];
  topics: string[];
  updatedAt: string;
  activeTag?: string | null;
  activeTopic?: string | null;
};

type RankingWeights = {
  titlePhrase: number;
  bodyPhrase: number;
  titleTerm: number;
  bodyTerm: number;
  tagTerm: number;
  topicTerm: number;
  activeTag: number;
  activeTopic: number;
  recencyMax: number;
  recencyHalfLifeDays: number;
};

function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getWeights(): RankingWeights {
  return {
    titlePhrase: numberFromEnv("SEARCH_WEIGHT_TITLE_PHRASE", 18),
    bodyPhrase: numberFromEnv("SEARCH_WEIGHT_BODY_PHRASE", 10),
    titleTerm: numberFromEnv("SEARCH_WEIGHT_TITLE_TERM", 4),
    bodyTerm: numberFromEnv("SEARCH_WEIGHT_BODY_TERM", 1.5),
    tagTerm: numberFromEnv("SEARCH_WEIGHT_TAG_TERM", 3),
    topicTerm: numberFromEnv("SEARCH_WEIGHT_TOPIC_TERM", 2.5),
    activeTag: numberFromEnv("SEARCH_WEIGHT_ACTIVE_TAG_FILTER", 4),
    activeTopic: numberFromEnv("SEARCH_WEIGHT_ACTIVE_TOPIC_FILTER", 3),
    recencyMax: numberFromEnv("SEARCH_WEIGHT_RECENCY_MAX", 2),
    recencyHalfLifeDays: numberFromEnv("SEARCH_WEIGHT_RECENCY_HALF_LIFE_DAYS", 30)
  };
}

export function scoreConversation(input: RankingInput) {
  const weights = getWeights();
  const query = input.query.trim().toLowerCase();
  const terms = uniqueStrings(tokenize(input.query));
  const titleLower = input.title.toLowerCase();
  const bodyLower = input.fullText.toLowerCase();
  const tagsLower = input.tags.map((item) => item.toLowerCase());
  const topicsLower = input.topics.map((item) => item.toLowerCase());
  const signals: string[] = [];
  const matchFields = new Set<"title" | "message" | "tag" | "topic">();
  let score = 0;

  if (query.length > 1 && titleLower.includes(query)) {
    score += weights.titlePhrase;
    signals.push("title phrase");
    matchFields.add("title");
  }

  if (query.length > 1 && bodyLower.includes(query)) {
    score += weights.bodyPhrase;
    signals.push("message phrase");
    matchFields.add("message");
  }

  let titleTermHits = 0;
  let bodyTermHits = 0;
  let tagHits = 0;
  let topicHits = 0;

  for (const term of terms) {
    if (titleLower.includes(term)) {
      score += weights.titleTerm;
      titleTermHits += 1;
      matchFields.add("title");
    }
    if (bodyLower.includes(term)) {
      score += weights.bodyTerm;
      bodyTermHits += 1;
      matchFields.add("message");
    }
    if (tagsLower.some((item) => item.includes(term))) {
      score += weights.tagTerm;
      tagHits += 1;
      matchFields.add("tag");
    }
    if (topicsLower.some((item) => item.includes(term))) {
      score += weights.topicTerm;
      topicHits += 1;
      matchFields.add("topic");
    }
  }

  if (titleTermHits > 0) signals.push("title terms");
  if (bodyTermHits > 0) signals.push("message terms");
  if (tagHits > 0) signals.push("tag overlap");
  if (topicHits > 0) signals.push("topic overlap");

  if (input.activeTag && tagsLower.includes(input.activeTag.toLowerCase())) {
    score += weights.activeTag;
    signals.push("active tag");
  }

  if (input.activeTopic && topicsLower.includes(input.activeTopic.toLowerCase())) {
    score += weights.activeTopic;
    signals.push("active topic");
  }

  const updatedAtMs = Date.parse(input.updatedAt);
  if (Number.isFinite(updatedAtMs)) {
    const ageDays = Math.max(0, (Date.now() - updatedAtMs) / 86_400_000);
    const recencyBoost = weights.recencyMax * Math.exp(-ageDays / Math.max(1, weights.recencyHalfLifeDays));
    score += recencyBoost;
    if (recencyBoost > 0.5) {
      signals.push("recent");
    }
  }

  return {
    score: Number(score.toFixed(3)),
    signals: uniqueStrings(signals),
    matchFields: Array.from(matchFields)
  };
}

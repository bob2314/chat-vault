export type Role = "user" | "assistant" | "system";

export type ImportedMessage = {
  role: Role;
  content: string;
  createdAt?: string | null;
};

export type ImportedConversation = {
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
  topics?: string[];
  messages: ImportedMessage[];
};

export type ImportPayload = {
  conversations: ImportedConversation[];
};

export type SearchParams = {
  userId: string;
  query: string;
  tag?: string | null;
  topic?: string | null;
};

export type ConversationSearchResult = {
  id: string;
  title: string;
  snippet: string;
  tags: string[];
  topics: string[];
  matchFields: Array<"title" | "message" | "tag" | "topic">;
  matchSignals: string[];
  bestMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  score: number;
  messageCount: number;
};

export type SearchResponse = {
  total: number;
  query: string;
  tag: string | null;
  topic: string | null;
  availableTags?: string[];
  availableTopics?: string[];
  results: ConversationSearchResult[];
};

export type SavedSearch = {
  id: number;
  userId: string;
  name: string;
  query: string;
  tag: string | null;
  topic: string | null;
  createdAt: string;
};

export type AnalyticsResponse = {
  totals: {
    conversations: number;
    messages: number;
    tags: number;
    topics: number;
    savedSearches: number;
    noResultSearches: number;
  };
  topTags: Array<{ label: string; count: number }>;
  topTopics: Array<{ label: string; count: number }>;
  monthlyConversations: Array<{ month: string; count: number }>;
  searchesByDay: Array<{ day: string; count: number; noResultCount: number }>;
  searchHeatmap: Array<{ day: string; count: number; noResultCount: number }>;
  noResultQueries: Array<{ query: string; count: number }>;
  recentSavedSearches: SavedSearch[];
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

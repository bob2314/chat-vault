export interface EmbeddingProvider {
  getName(): string;
  isConfigured(): boolean;
  dimensions(): number;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

class DisabledEmbeddingProvider implements EmbeddingProvider {
  getName() {
    return "disabled";
  }

  isConfigured() {
    return false;
  }

  dimensions() {
    return 0;
  }

  async embedQuery(_: string): Promise<number[]> {
    throw new Error("Embedding provider is not configured.");
  }

  async embedDocuments(_: string[]): Promise<number[][]> {
    throw new Error("Embedding provider is not configured.");
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;
  provider = new DisabledEmbeddingProvider();
  return provider;
}

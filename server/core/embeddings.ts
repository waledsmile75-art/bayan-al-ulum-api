import { pipeline, env } from "@xenova/transformers";

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

type FeatureExtractor = (text: string, options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;

/** Real semantic embeddings. No hash vectors or synthetic fallback is used. */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
  private extractor: FeatureExtractor | null = null;

  constructor() {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  }

  private async getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.extractor = (await pipeline("feature-extraction", this.name, {
        quantized: true,
      })) as unknown as FeatureExtractor;
    }
    return this.extractor;
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const output = await (await this.getExtractor())(normalized, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    const result: number[][] = [];
    for (const text of texts) result.push(await this.embed(text));
    return result;
  }
}

export const embeddingProvider = new TransformersEmbeddingProvider();

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

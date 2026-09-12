export type VerificationStatus =
  | "Verified"
  | "Partially Supported"
  | "Contradicted"
  | "Analytical Inference"
  | "Insufficient Evidence"
  | "Unverified";

export type EvidenceRelation = "supports_claim" | "partial_support" | "contradicts_claim" | "irrelevant";

export type ChunkRecord = {
  id: number;
  documentId: number;
  pageId: number;
  pageNumber: number;
  sectionId: number | null;
  sectionTitle: string | null;
  text: string;
  startPosition: number;
  endPosition: number;
  chunkIndex: number;
  embedding: number[] | null;
};

export type RetrievalResult = ChunkRecord & {
  keywordScore: number;
  semanticScore: number;
  finalScore: number;
};

export type Evidence = RetrievalResult & {
  evidenceId: number;
  sourceType: "file" | "external" | "reasoning";
  sourceName: string;
  relevanceScore: number;
  directnessScore: number;
  sourceQuality: string;
  extractionQuality: number;
  confidenceScore: number;
  confidenceReasons: string[];
};

export type VerificationResult = {
  status: VerificationStatus;
  answer: string;
  confidenceScore: number;
  confidenceReasons: string[];
  evidence: Evidence[];
  contradictions: Array<{
    contradictionType: "contextual_difference" | "direct_conflict";
    claimScope: string;
    evidenceA: string;
    evidenceB: string;
    explanation: string;
  }>;
};

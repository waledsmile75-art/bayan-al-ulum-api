import { getApiBaseUrl } from "@/constants/oauth";

const base = getApiBaseUrl();

export type CoreSnapshot = { projects: number; documents: number; pages: number; chunks: number; embeddings: number; claims: number; evidence: number };
export type CoreAnswer = { status: string; answer: string; confidenceScore: number; confidenceReasons: string[]; evidence: Array<{ evidenceId: number; pageNumber: number; text: string; sourceName: string; finalScore: number; keywordScore: number; semanticScore: number }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || "CORE_REQUEST_FAILED");
  return body;
}

export async function getCoreSnapshot() { return (await request<{ snapshot: CoreSnapshot }>("/api/core/snapshot")).snapshot; }
export async function askCore(question: string) { return (await request<{ result: CoreAnswer }>("/api/core/ask", { method: "POST", body: JSON.stringify({ question }) })).result; }
export async function ingestPdf(filename: string, dataBase64: string) { return (await request<{ result: { documentId: number; pageCount: number; chunkCount: number } }>("/api/core/ingest", { method: "POST", body: JSON.stringify({ filename, dataBase64 }) })).result; }

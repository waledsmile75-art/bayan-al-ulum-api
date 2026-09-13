import { getApiBaseUrl } from "@/constants/oauth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_OVERRIDE_KEY = "bayan_api_override";

export async function getConfiguredApiBaseUrl() { return (await AsyncStorage.getItem(API_OVERRIDE_KEY)) || getApiBaseUrl(); }
export async function setConfiguredApiBaseUrl(value: string) { const normalized = value.trim().replace(/\/$/, ""); if (normalized) await AsyncStorage.setItem(API_OVERRIDE_KEY, normalized); else await AsyncStorage.removeItem(API_OVERRIDE_KEY); }

export type CoreSnapshot = { projects: number; documents: number; pages: number; chunks: number; embeddings: number; claims: number; evidence: number };
export type CoreAnswer = { status: string; answer: string; confidenceScore: number; confidenceReasons: string[]; evidence: Array<{ evidenceId: number; pageNumber: number; text: string; sourceName: string; finalScore: number; keywordScore: number; semanticScore: number }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${await getConfiguredApiBaseUrl()}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new Error("الخادم غير متاح حاليًا. تم الاحتفاظ بالبيانات محليًا.");
  }
  const raw = await response.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { throw new Error(response.ok ? "استجابة غير مفهومة من الخادم." : "الخادم غير متاح حاليًا. أعد المحاولة عند عودة الاتصال."); }
  if (!response.ok || body.ok === false) throw new Error(body.error || "CORE_REQUEST_FAILED");
  return body;
}

export async function getCoreSnapshot() { return (await request<{ snapshot: CoreSnapshot }>("/api/core/snapshot")).snapshot; }
export async function askCore(question: string, documentId?: number) { return (await request<{ result: CoreAnswer }>("/api/core/ask", { method: "POST", body: JSON.stringify({ question, documentId }) })).result; }
export async function ingestPdf(filename: string, dataBase64: string) { return (await request<{ result: { documentId: number; pageCount: number; chunkCount: number } }>("/api/core/ingest", { method: "POST", body: JSON.stringify({ filename, dataBase64 }) })).result; }
export async function analyzeImage(imageBase64: string, mimeType = "image/jpeg", prompt?: string) { return (await request<{ result: { analysis: string; model: string } }>("/api/core/analyze-image", { method: "POST", body: JSON.stringify({ imageBase64, mimeType, prompt }) })).result; }
export async function summarizeDocument(question?: string, documentId?: number) { return (await request<{ result: { text: string } }>("/api/core/summarize", { method: "POST", body: JSON.stringify({ question, documentId }) })).result.text; }
export async function explainDocument(question?: string, documentId?: number) { return (await request<{ result: { text: string } }>("/api/core/explain", { method: "POST", body: JSON.stringify({ question, documentId }) })).result.text; }
export async function translateDocument(documentId: number, targetLanguage: string) { return (await request<{ result: { text: string } }>("/api/core/translate", { method: "POST", body: JSON.stringify({ documentId, targetLanguage }) })).result.text; }

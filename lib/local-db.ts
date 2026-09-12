export type LocalDocument = { id: number; filename: string; uri: string; status: "pending" | "syncing" | "synced" | "failed"; attempts: number; lastError: string | null; createdAt: string };
export type QueueItem = LocalDocument;

const memoryDocs: LocalDocument[] = [];
const memoryAnswers = new Map<string, unknown>();

export async function initLocalStore() {}
export async function enqueueDocument(filename: string, uri: string): Promise<LocalDocument> {
  const item = { id: Date.now(), filename, uri, status: "pending" as const, attempts: 0, lastError: null, createdAt: new Date().toISOString() };
  memoryDocs.push(item); return item;
}
export async function listPendingDocuments() { return memoryDocs.filter((item) => item.status !== "synced"); }
export async function listLocalDocuments() { return [...memoryDocs].reverse(); }
export async function markDocumentSyncing(id: number) { const item = memoryDocs.find((doc) => doc.id === id); if (item) item.status = "syncing"; }
export async function markDocumentResult(id: number, ok: boolean, error?: string) { const item = memoryDocs.find((doc) => doc.id === id); if (item) { item.status = ok ? "synced" : "failed"; item.lastError = error ?? null; item.attempts += 1; } }
export async function saveCachedAnswer(question: string, payload: unknown) { memoryAnswers.set(question.trim().toLowerCase(), payload); }
export async function getCachedAnswer<T>(question: string): Promise<T | null> { return (memoryAnswers.get(question.trim().toLowerCase()) as T | undefined) ?? null; }
export async function getLocalCounts() { return { documents: memoryDocs.length, pending: memoryDocs.filter((item) => item.status !== "synced").length }; }

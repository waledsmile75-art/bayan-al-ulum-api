import { Platform } from "react-native";
import type * as SQLiteTypes from "expo-sqlite";

export type LocalDocument = { id: number; filename: string; uri: string; remoteDocumentId?: number; status: "pending" | "syncing" | "synced" | "failed"; attempts: number; lastError: string | null; createdAt: string };
export type QueueItem = LocalDocument;

let dbPromise: Promise<SQLiteTypes.SQLiteDatabase | null> | null = null;
const memoryDocs: LocalDocument[] = [];
const memoryAnswers = new Map<string, unknown>();

async function db() {
  if (Platform.OS === "web") return null;
  if (!dbPromise) {
    dbPromise = import("expo-sqlite").then(({ openDatabaseAsync }) => openDatabaseAsync("bayan-local.db")).then(async (database) => {
      await database.execAsync(`PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS local_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          uri TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          remote_document_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS cached_answers (
          question TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );`);
      await database.execAsync("ALTER TABLE local_documents ADD COLUMN remote_document_id INTEGER").catch(() => undefined);
      return database;
    });
  }
  return dbPromise;
}

export async function initLocalStore() { await db(); }

export async function enqueueDocument(filename: string, uri: string): Promise<LocalDocument> {
  const createdAt = new Date().toISOString();
  const database = await db();
  if (!database) {
    const item = { id: Date.now(), filename, uri, status: "pending" as const, attempts: 0, lastError: null, createdAt };
    memoryDocs.push(item); return item;
  }
  const result = await database.runAsync("INSERT INTO local_documents (filename, uri, status, created_at) VALUES (?, ?, 'pending', ?)", filename, uri, createdAt);
  return { id: result.lastInsertRowId, filename, uri, status: "pending", attempts: 0, lastError: null, createdAt };
}

export async function listPendingDocuments(): Promise<QueueItem[]> {
  const database = await db();
  if (!database) return memoryDocs.filter((item) => item.status !== "synced");
  return database.getAllAsync<LocalDocument>("SELECT id, filename, uri, remote_document_id as remoteDocumentId, status, attempts, last_error as lastError, created_at as createdAt FROM local_documents WHERE status IN ('pending', 'failed') ORDER BY id ASC");
}

export async function listLocalDocuments(): Promise<LocalDocument[]> {
  const database = await db();
  if (!database) return [...memoryDocs].reverse();
  return database.getAllAsync<LocalDocument>("SELECT id, filename, uri, remote_document_id as remoteDocumentId, status, attempts, last_error as lastError, created_at as createdAt FROM local_documents ORDER BY id DESC");
}

export async function markDocumentSyncing(id: number) {
  const database = await db();
  if (!database) { const item = memoryDocs.find((doc) => doc.id === id); if (item) item.status = "syncing"; return; }
  await database.runAsync("UPDATE local_documents SET status='syncing', attempts=attempts+1 WHERE id=?", id);
}

export async function markDocumentResult(id: number, ok: boolean, error?: string, remoteDocumentId?: number) {
  const database = await db();
  if (!database) { const item = memoryDocs.find((doc) => doc.id === id); if (item) { item.status = ok ? "synced" : "failed"; item.lastError = error ?? null; item.attempts += 1; } return; }
  await database.runAsync("UPDATE local_documents SET status=?, last_error=?, remote_document_id=COALESCE(?, remote_document_id) WHERE id=?", ok ? "synced" : "failed", error ?? null, remoteDocumentId ?? null, id);
}

export async function saveCachedAnswer(question: string, payload: unknown) {
  const database = await db();
  const normalized = question.trim().toLowerCase();
  if (!database) { memoryAnswers.set(normalized, payload); return; }
  await database.runAsync("INSERT OR REPLACE INTO cached_answers (question, payload, created_at) VALUES (?, ?, ?)", normalized, JSON.stringify(payload), new Date().toISOString());
}

export async function getCachedAnswer<T>(question: string): Promise<T | null> {
  const database = await db();
  const normalized = question.trim().toLowerCase();
  if (!database) return (memoryAnswers.get(normalized) as T | undefined) ?? null;
  const row = await database.getFirstAsync<{ payload: string }>("SELECT payload FROM cached_answers WHERE question=?", normalized);
  return row ? JSON.parse(row.payload) as T : null;
}

export async function getLocalCounts() {
  const database = await db();
  if (!database) return { documents: memoryDocs.length, pending: memoryDocs.filter((item) => item.status !== "synced").length };
  const row = await database.getFirstAsync<{ documents: number; pending: number }>("SELECT COUNT(*) AS documents, SUM(CASE WHEN status != 'synced' THEN 1 ELSE 0 END) AS pending FROM local_documents");
  return { documents: row?.documents ?? 0, pending: row?.pending ?? 0 };
}

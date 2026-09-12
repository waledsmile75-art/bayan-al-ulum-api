import * as FileSystem from "expo-file-system/legacy";
import { ingestPdf } from "@/lib/core-api";
import { listPendingDocuments, markDocumentResult, markDocumentSyncing, type QueueItem } from "@/lib/local-db";

let running = false;

export async function syncPendingDocuments(): Promise<{ synced: number; pending: number }> {
  if (running) return { synced: 0, pending: (await listPendingDocuments()).length };
  running = true;
  let synced = 0;
  let networkUnavailable = false;
  try {
    const queue = await listPendingDocuments();
    for (const item of queue) {
      if (networkUnavailable) break;
      try {
        await markDocumentSyncing(item.id);
        const dataBase64 = await FileSystem.readAsStringAsync(item.uri, { encoding: FileSystem.EncodingType.Base64 });
        await ingestPdf(item.filename, dataBase64);
        await markDocumentResult(item.id, true);
        synced += 1;
      } catch (error) {
        await markDocumentResult(item.id, false, String(error));
        if (String(error).includes("الخادم غير متاح") || String(error).includes("Network request failed")) networkUnavailable = true;
      }
    }
    return { synced, pending: (await listPendingDocuments()).length };
  } finally {
    running = false;
  }
}

export function queueErrorMessage(item: QueueItem) {
  if (item.lastError?.includes("Network request failed")) return "بانتظار عودة الاتصال";
  return item.lastError ?? "بانتظار المزامنة";
}

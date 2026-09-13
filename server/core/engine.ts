import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { initSqlite, sqlite } from "./sqlite";
import { embeddingProvider, cosineSimilarity } from "./embeddings";
import { smartChunk } from "./chunking";
import { verifyClaim } from "./verification";
import type { Evidence, RetrievalResult, VerificationResult } from "./types";

function keywordScore(query: string, text: string): number {
  const q = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const t = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []); if (!q.size) return 0;
  let hits = 0; for (const word of q) if (t.has(word)) hits += 1;
  return hits / q.size;
}

function makeProject(name = "مشروع بيان العلوم"): number {
  const row = sqlite.prepare("SELECT id FROM projects WHERE name=?").get(name) as { id: number } | undefined;
  return row?.id ?? Number(sqlite.prepare("INSERT INTO projects(name) VALUES(?)").run(name).lastInsertRowid);
}

export async function ingestPdf(filePath: string, projectId?: number): Promise<{ documentId: number; pageCount: number; chunkCount: number }> {
  await initSqlite();
  projectId ??= makeProject();
  if (!fs.existsSync(filePath)) throw new Error("PDF_NOT_FOUND");
  const stat = fs.statSync(filePath);
  const existing = sqlite.prepare("SELECT id FROM documents WHERE project_id=? AND file_path=?").get(projectId, path.resolve(filePath)) as { id: number } | undefined;
  if (existing) {
    const pageCount = (sqlite.prepare("SELECT COUNT(*) AS c FROM pages WHERE document_id=?").get(existing.id) as { c: number }).c;
    const chunkCount = (sqlite.prepare("SELECT COUNT(*) AS c FROM chunks WHERE document_id=?").get(existing.id) as { c: number }).c;
    return { documentId: existing.id, pageCount: Number(pageCount), chunkCount: Number(chunkCount) };
  }
  const documentId = Number(sqlite.prepare("INSERT INTO documents(project_id,filename,file_type,file_path,size,status) VALUES(?,?,?,?,?,?)").run(projectId, path.basename(filePath), "application/pdf", path.resolve(filePath), stat.size, "EXTRACT").lastInsertRowid);
  const taskId = Number(sqlite.prepare("INSERT INTO tasks(project_id,document_id,status,current_stage,progress,last_completed_step) VALUES(?,?,?,?,?,?)").run(projectId, documentId, "RUNNING", "EXTRACT", 0, "UPLOAD").lastInsertRowid);
  try {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const parsed = await parser.getText();
    await parser.destroy();
    if (!parsed.pages.length || !parsed.text.trim()) throw new Error("EMPTY_PDF");
    const insertPage = sqlite.prepare("INSERT INTO pages(document_id,page_number,raw_text,extraction_status,extraction_quality) VALUES(?,?,?,?,?)");
    const pages: Array<{ pageId: number; pageNumber: number; text: string }> = [];
    for (const page of parsed.pages) {
      const text = page.text.trim();
      const pageId = Number(insertPage.run(documentId, page.num, text, text ? "EXTRACTED" : "EMPTY", text ? 1 : 0.1).lastInsertRowid);
      pages.push({ pageId, pageNumber: page.num, text });
    }
    sqlite.prepare("UPDATE tasks SET current_stage='CHUNK',progress=0.4,last_completed_step='EXTRACT',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(taskId);
    const chunks = smartChunk(pages);
    const insertChunk = sqlite.prepare("INSERT INTO chunks(document_id,page_id,page_number,text,start_position,end_position,chunk_index) VALUES(?,?,?,?,?,?,?)");
    const chunkRows: Array<{ id: number; text: string }> = [];
    for (const chunk of chunks) {
      const id = Number(insertChunk.run(documentId, chunk.pageId, chunk.pageNumber, chunk.text, chunk.startPosition, chunk.endPosition, chunk.chunkIndex).lastInsertRowid);
      chunkRows.push({ id, text: chunk.text });
    }
    sqlite.prepare("UPDATE tasks SET current_stage='EMBED',progress=0.65,last_completed_step='CHUNK',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(taskId);
    const insertEmbedding = sqlite.prepare("INSERT INTO embeddings(chunk_id,provider,vector_json,dimensions) VALUES(?,?,?,?)");
    for (const row of chunkRows) {
      const vector = await embeddingProvider.embed(row.text);
      insertEmbedding.run(row.id, embeddingProvider.name, JSON.stringify(vector), vector.length);
    }
    sqlite.prepare("UPDATE documents SET status='READY',extraction_quality=1 WHERE id=?").run(documentId);
    sqlite.prepare("UPDATE tasks SET status='COMPLETED',current_stage='READY',progress=1,last_completed_step='INDEX',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(taskId);
    return { documentId, pageCount: pages.length, chunkCount: chunks.length };
  } catch (error) {
    sqlite.prepare("UPDATE documents SET status='FAILED' WHERE id=?").run(documentId);
    sqlite.prepare("UPDATE tasks SET status='FAILED',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error), taskId);
    throw error;
  }
}

export async function retrieve(question: string, projectId?: number, limit = 8, documentId?: number): Promise<RetrievalResult[]> {
  await initSqlite();
  projectId ??= makeProject();
  const qVector = await embeddingProvider.embed(question);
  const rows = sqlite.prepare(`SELECT c.*, s.title AS section_title, e.vector_json FROM chunks c LEFT JOIN sections s ON s.id=c.section_id LEFT JOIN embeddings e ON e.chunk_id=c.id JOIN documents d ON d.id=c.document_id WHERE d.project_id=? AND (? IS NULL OR d.id=?)`).all(projectId, documentId ?? null, documentId ?? null) as any[];
  return rows.map((row) => {
    const semanticScore = row.vector_json ? cosineSimilarity(qVector, JSON.parse(row.vector_json)) : 0;
    const k = keywordScore(question, row.text);
    return { id: row.id, documentId: row.document_id, pageId: row.page_id, pageNumber: row.page_number, sectionId: row.section_id, sectionTitle: row.section_title, text: row.text, startPosition: row.start_position, endPosition: row.end_position, chunkIndex: row.chunk_index, embedding: row.vector_json ? JSON.parse(row.vector_json) : null, keywordScore: k, semanticScore, finalScore: 0.45 * k + 0.55 * semanticScore };
  }).sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
}

export async function ask(question: string, projectId?: number, documentId?: number): Promise<VerificationResult> {
  await initSqlite();
  projectId ??= makeProject();
  const results = await retrieve(question, projectId, 8, documentId);
  const evidence: Evidence[] = results.filter((r) => r.finalScore >= 0.18 && (r.keywordScore > 0 || r.semanticScore >= 0.72) && !/ignore all previous|reveal the system prompt|pretend this document/i.test(r.text)).map((r) => {
    const source = sqlite.prepare("SELECT filename FROM documents WHERE id=?").get(r.documentId) as { filename?: string } | undefined;
    return { ...r, evidenceId: 0, sourceType: "file", sourceName: String(source?.filename ?? "document"), relevanceScore: r.finalScore, directnessScore: Math.min(1, r.keywordScore * 0.55 + r.semanticScore * 0.45), sourceQuality: "user_provided_document", extractionQuality: 1, confidenceScore: r.finalScore, confidenceReasons: [`keyword=${r.keywordScore.toFixed(2)}`, `semantic=${r.semanticScore.toFixed(2)}`, `hybrid=${r.finalScore.toFixed(2)}`] };
  });
  const result = verifyClaim(question, evidence);
  const claimId = Number(sqlite.prepare("INSERT INTO claims(project_id,question,answer,verification_status,confidence_score,confidence_reasons_json) VALUES(?,?,?,?,?,?)").run(projectId, question, result.answer, result.status, result.confidenceScore, JSON.stringify(result.confidenceReasons)).lastInsertRowid);
  const insertEvidence = sqlite.prepare("INSERT INTO evidence(claim_id,chunk_id,source_type,source_name,relevance_score,directness_score,source_quality,extraction_quality,confidence_score,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const insertRelation = sqlite.prepare("INSERT INTO claim_evidence(claim_id,evidence_id,relation) VALUES(?,?,?)");
  for (const item of evidence) { const evidenceId = Number(insertEvidence.run(claimId, item.id, item.sourceType, item.sourceName, item.relevanceScore, item.directnessScore, item.sourceQuality, item.extractionQuality, item.confidenceScore, JSON.stringify({ pageNumber: item.pageNumber, startPosition: item.startPosition, endPosition: item.endPosition, keywordScore: item.keywordScore, semanticScore: item.semanticScore, finalScore: item.finalScore })).lastInsertRowid); item.evidenceId = evidenceId; insertRelation.run(claimId, evidenceId, result.status === "Contradicted" ? "contradicts_claim" : result.status === "Partially Supported" ? "partial_support" : "supports_claim"); }
  return result;
}

export async function resumeTask(taskId: number) {
  await initSqlite();
  const task = sqlite.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) as { id: number; document_id: number; current_stage: string } | undefined;
  if (!task) throw new Error("TASK_NOT_FOUND");
  const rows = sqlite.prepare("SELECT c.id, c.text FROM chunks c LEFT JOIN embeddings e ON e.chunk_id=c.id WHERE c.document_id=? AND e.id IS NULL").all(task.document_id) as Array<{ id: number; text: string }>;
  const document = sqlite.prepare("SELECT filename FROM documents WHERE id=?").get(task.document_id) as { filename: string };
  const insert = sqlite.prepare("INSERT INTO embeddings(chunk_id,provider,vector_json,dimensions) VALUES(?,?,?,?)");
  for (const row of rows) { const vector = await embeddingProvider.embed(row.text); insert.run(row.id, embeddingProvider.name, JSON.stringify(vector), vector.length); }
  sqlite.prepare("UPDATE documents SET status='READY', extraction_quality=1 WHERE id=?").run(task.document_id);
  sqlite.prepare("UPDATE tasks SET status='COMPLETED',current_stage='READY',progress=1,last_completed_step='INDEX',updated_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").run(taskId);
  return { taskId, documentId: task.document_id, filename: document.filename, resumedChunks: rows.length, status: "READY" as const };
}

export async function persistenceSnapshot(projectId?: number) {
  await initSqlite();
  projectId ??= makeProject();
  const count = (sql: string, ...params: unknown[]) => Number((sqlite.prepare(sql).get(...params) as { c: number }).c);
  return {
    projects: count("SELECT COUNT(*) c FROM projects"),
    documents: count("SELECT COUNT(*) c FROM documents WHERE project_id=?", projectId),
    pages: count("SELECT COUNT(*) c FROM pages"),
    chunks: count("SELECT COUNT(*) c FROM chunks"),
    embeddings: count("SELECT COUNT(*) c FROM embeddings"),
    claims: count("SELECT COUNT(*) c FROM claims"),
    evidence: count("SELECT COUNT(*) c FROM evidence"),
  };
}

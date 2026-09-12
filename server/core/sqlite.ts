import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";

export const DB_PATH = process.env.BAYAN_SQLITE_PATH || path.resolve(process.cwd(), "data", "bayan.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

type Row = Record<string, any>;
class Statement {
  constructor(private readonly db: SqlJsDatabase, private readonly sql: string) {}
  run(...params: unknown[]) {
    const stmt = this.db.prepare(this.sql); stmt.bind(params as any); while (stmt.step()) { /* execute */ } stmt.free();
    const id = this.db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ?? 0;
    persist(this.db);
    return { lastInsertRowid: Number(id) };
  }
  get(...params: unknown[]): Row | undefined { const stmt = this.db.prepare(this.sql); stmt.bind(params as any); const row = stmt.step() ? stmt.getAsObject() as Row : undefined; stmt.free(); return row; }
  all(...params: unknown[]): Row[] { const stmt = this.db.prepare(this.sql); stmt.bind(params as any); const rows: Row[] = []; while (stmt.step()) rows.push(stmt.getAsObject() as Row); stmt.free(); return rows; }
}

let wasm: SqlJsStatic | null = null;
let database: SqlJsDatabase | null = null;
function persist(db: SqlJsDatabase) { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }

export const sqlite = {
  exec(sql: string) { if (!database) throw new Error("SQLITE_NOT_INITIALIZED"); database.run(sql); persist(database); },
  prepare(sql: string) { if (!database) throw new Error("SQLITE_NOT_INITIALIZED"); return new Statement(database, sql); },
};

export async function initSqlite() {
  if (database) return sqlite;
  wasm ??= await initSqlJs({ locateFile: (file) => path.resolve(process.cwd(), "node_modules", "sql.js", "dist", file) });
  const existing = fs.existsSync(DB_PATH) ? new Uint8Array(fs.readFileSync(DB_PATH)) : undefined;
  database = new wasm.Database(existing);
  database.run("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  database.run(`
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, filename TEXT NOT NULL, file_type TEXT NOT NULL, file_path TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'UPLOADED', extraction_quality REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, file_path));
CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_number INTEGER NOT NULL, raw_text TEXT NOT NULL, extraction_status TEXT NOT NULL, extraction_quality REAL NOT NULL, UNIQUE(document_id, page_number));
CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL, title TEXT NOT NULL, start_position INTEGER NOT NULL, end_position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL, page_number INTEGER NOT NULL, text TEXT NOT NULL, start_position INTEGER NOT NULL, end_position INTEGER NOT NULL, chunk_index INTEGER NOT NULL, UNIQUE(document_id, page_id, chunk_index));
CREATE TABLE IF NOT EXISTS embeddings (id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id INTEGER NOT NULL UNIQUE REFERENCES chunks(id) ON DELETE CASCADE, provider TEXT NOT NULL, vector_json TEXT NOT NULL, dimensions INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, question TEXT NOT NULL, answer TEXT NOT NULL, verification_status TEXT NOT NULL, confidence_score REAL NOT NULL, confidence_reasons_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE, chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, source_type TEXT NOT NULL, source_name TEXT NOT NULL, relevance_score REAL NOT NULL, directness_score REAL NOT NULL, source_quality TEXT NOT NULL, extraction_quality REAL NOT NULL, confidence_score REAL NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claim_evidence (claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE, evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE, relation TEXT NOT NULL, PRIMARY KEY(claim_id, evidence_id));
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE, status TEXT NOT NULL, current_stage TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, last_completed_step TEXT, error TEXT, retry_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, stage TEXT NOT NULL, status TEXT NOT NULL, message TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id); CREATE INDEX IF NOT EXISTS idx_pages_document_page ON pages(document_id, page_number); CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page_number); CREATE INDEX IF NOT EXISTS idx_evidence_claim ON evidence(claim_id); CREATE INDEX IF NOT EXISTS idx_tasks_document ON tasks(document_id);
`);
  persist(database);
  return sqlite;
}

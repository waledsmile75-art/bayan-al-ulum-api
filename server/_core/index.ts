import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import fs from "node:fs";
import path from "node:path";
import { ask, ingestPdf, persistenceSnapshot, resumeTask, retrieve } from "../core/engine";
import { invokeLLM } from "./llm";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/core/snapshot", async (_req, res) => {
    res.json({ ok: true, snapshot: await persistenceSnapshot() });
  });

  app.post("/api/core/ingest", async (req, res) => {
    try {
      const { filename, dataBase64, projectId } = req.body as { filename?: string; dataBase64?: string; projectId?: number };
      if (!filename || !dataBase64) return res.status(400).json({ ok: false, error: "filename and dataBase64 are required" });
      const uploadDir = path.resolve(process.cwd(), "data", "uploads");
      fs.mkdirSync(uploadDir, { recursive: true });
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join(uploadDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(dataBase64, "base64"));
      const result = await ingestPdf(filePath, projectId);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(422).json({ ok: false, error: String(error) });
    }
  });

  app.post("/api/core/ask", async (req, res) => {
    try {
      const { question, projectId } = req.body as { question?: string; projectId?: number };
      if (!question?.trim()) return res.status(400).json({ ok: false, error: "question is required" });
      res.json({ ok: true, result: await ask(question.trim(), projectId) });
    } catch (error) {
      res.status(422).json({ ok: false, error: String(error) });
    }
  });

  async function groundedWriting(mode: "summary" | "explain", question?: string) {
    const evidence = await retrieve(question?.trim() || "المحتوى والأفكار الرئيسية في المستند", undefined, 10);
    if (!evidence.length) throw new Error("لا توجد مستندات مفهرسة. ارفع ملفًا وانتظر اكتمال الفهرسة أولًا.");
    const context = evidence.map((item, index) => `[${index + 1}] صفحة ${item.pageNumber}: ${item.text}`).join("\n\n");
    const instruction = mode === "summary" ? "اكتب ملخصًا عربيًا منظمًا للمحتوى اعتمادًا على الأدلة فقط، مع عناوين ونقاط رئيسية، ولا تضف معلومات غير موجودة." : `اشرح المحتوى بالعربية شرحًا مبسطًا ودقيقًا${question ? ` مع التركيز على: ${question}` : ""}، واربط كل فكرة بالدليل المناسب ولا تخترع معلومات.`;
    const result = await invokeLLM({ model: "gemini-2.5-flash", maxTokens: 1800, messages: [{ role: "user", content: `${instruction}\n\nالمصادر:\n${context}` }] });
    const content = result.choices[0]?.message.content;
    return typeof content === "string" ? content : content?.map((part) => part.type === "text" ? part.text : "").join(" ").trim() || "تعذر إنشاء النتيجة.";
  }

  app.post("/api/core/summarize", async (req, res) => {
    try { res.json({ ok: true, result: { text: await groundedWriting("summary", req.body?.question) } }); }
    catch (error) { res.status(422).json({ ok: false, error: String(error) }); }
  });

  app.post("/api/core/explain", async (req, res) => {
    try { res.json({ ok: true, result: { text: await groundedWriting("explain", req.body?.question) } }); }
    catch (error) { res.status(422).json({ ok: false, error: String(error) }); }
  });

  app.post("/api/core/tasks/:taskId/resume", async (req, res) => {
    try {
      res.json({ ok: true, result: await resumeTask(Number(req.params.taskId)) });
    } catch (error) {
      res.status(422).json({ ok: false, error: String(error) });
    }
  });

  app.post("/api/core/analyze-image", async (req, res) => {
    try {
      const { imageBase64, mimeType = "image/jpeg", prompt = "حلّل هذه الصورة بالعربية بدقة، صف محتواها واستخرج أي نص أو أرقام مهمة، واذكر ما لا يمكنك الجزم به." } = req.body as { imageBase64?: string; mimeType?: string; prompt?: string };
      if (!imageBase64) return res.status(400).json({ ok: false, error: "imageBase64 is required" });
      if (imageBase64.length > 15_000_000) return res.status(413).json({ ok: false, error: "الصورة أكبر من الحد المسموح 11MB" });
      const result = await invokeLLM({ model: "gemini-2.5-flash", maxTokens: 1200, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "auto" } }] }] });
      const content = result.choices[0]?.message.content;
      const analysis = typeof content === "string" ? content : content?.map((part) => part.type === "text" ? part.text : "").join(" ").trim();
      res.json({ ok: true, result: { analysis: analysis || "تعذر استخراج تحليل نصي من الصورة.", model: result.model } });
    } catch (error) {
      res.status(422).json({ ok: false, error: String(error) });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);

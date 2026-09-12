process.env.BAYAN_SQLITE_PATH = "/tmp/bayan-answer.sqlite";
const { initSqlite } = await import("../server/core/sqlite.ts"); await initSqlite();
const { ingestPdf, retrieve, ask } = await import("../server/core/engine.ts");
const path = "tests/fixtures/basic_scientific.pdf"; const p = 1; try { await ingestPdf(path, p); } catch {}
console.log((await retrieve("How many participants were included?", p)).map((x: any) => ({text:x.text, k:x.keywordScore,s:x.semanticScore,f:x.finalScore})));
console.log(await ask("How many participants were included?", p));

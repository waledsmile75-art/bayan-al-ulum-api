process.env.BAYAN_SQLITE_PATH = "/tmp/bayan-probe.sqlite";
const mod = await import("../server/core/sqlite.ts");
console.log("sqlite-loaded", !!mod.sqlite);
mod.sqlite.close();

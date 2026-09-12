process.env.BAYAN_SQLITE_PATH = "/tmp/bayan-probe-sqljs.sqlite";
const { initSqlite, sqlite } = await import("../server/core/sqlite.ts");
await initSqlite();
sqlite.exec("DELETE FROM projects;");
sqlite.prepare("INSERT INTO projects(name) VALUES(?)").run("x");
console.log(sqlite.prepare("SELECT COUNT(*) AS c FROM projects").get());

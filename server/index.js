import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
const config = loadConfig();
let repository;
if (config.databaseUrl) {
  const { PostgresRepository } = await import("./repositories/postgres.js");
  repository = new PostgresRepository({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
    caFile: config.caFile,
  });
} else {
  const { SqliteRepository } = await import("./repositories/sqlite.js");
  repository = new SqliteRepository(config.sqliteFile);
}
const app = createApp({ repository, config });
const server = app.listen(config.port, config.host, () => {
  console.log(`Host dashboard: http://${config.host}:${config.port}`);
  console.log(
    `${config.databaseUrl ? "Supabase PostgreSQL" : "Persistent local demo"}; ${config.authMode} identity mode.`,
  );
});
server.on("error", (error) => {
  console.error("Could not start the server.", { code: error.code });
  repository.close();
  process.exitCode = 1;
});
async function stop() {
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

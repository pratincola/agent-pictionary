import { buildServer } from "./app.js";

const server = await buildServer();
await server.listen();

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, "graceful shutdown");
  const timer = setTimeout(() => {
    server.log.error("shutdown timed out; exiting");
    process.exit(1);
  }, 15_000);
  timer.unref();
  server
    .close()
    .then(() => process.exit(0))
    .catch((err) => {
      server.log.error({ err }, "shutdown failed");
      process.exit(1);
    });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import { spawn } from "node:child_process";
import electronPath from "electron";
import { build } from "esbuild";
import { createServer } from "vite";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron", "@napi-rs/canvas"],
  sourcemap: true,
  logLevel: "warning"
};

await Promise.all([
  build({ ...shared, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs", format: "cjs" }),
  build({ ...shared, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs" })
]);

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5173/";
const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url }
});

const close = async () => {
  if (!child.killed) child.kill();
  await server.close();
};

child.on("exit", async (code) => {
  await close();
  process.exitCode = code ?? 0;
});
process.on("SIGINT", close);
process.on("SIGTERM", close);

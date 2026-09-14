import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist-electron", { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron", "@napi-rs/canvas"],
  sourcemap: true,
  logLevel: "info"
};

await Promise.all([
  build({ ...shared, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs", format: "cjs" }),
  build({ ...shared, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs" })
]);

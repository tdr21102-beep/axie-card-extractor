import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toCatalogCard } from "../src/catalog.ts";
import { acquireCardImage, downloadCard, outputPaths, sha1, sha256 } from "../src/downloader.ts";
import { card } from "./fixtures.ts";

const bytes = new Uint8Array([0x89, 0x50, 0x4e]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("SHA helpers are deterministic", () => {
  assert.equal(sha1(bytes), "22b1bd4f10536eed1d24735153d7630e4dc1393a");
  assert.equal(sha256(bytes), "449ba17f2a44989a58050282f82fec8663b84f57a6a443d3750033a0c02f8be9");
});

test("output paths use class and snake_case", () => {
  const paths = outputPaths(toCatalogCard(card()), "C:/poc");
  assert.match(paths.image.replace(/\\/g, "/"), /output\/raw\/aqua\/teal_shell\.png$/);
  assert.match(paths.metadata.replace(/\\/g, "/"), /output\/data\/teal_shell\.json$/);
});

test("download preserves bytes and then uses valid cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-card-test-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
  };
  const catalogCard = toCatalogCard(card({ asset: {
    ...card().asset!,
    size: pngBytes.byteLength,
    sha1hash: sha1(pngBytes)
  } }));

  const miss = await downloadCard(catalogCard, { root, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(miss.metadata.cache, "miss");
  assert.deepEqual(new Uint8Array(await readFile(miss.paths.image)), pngBytes);

  const hit = await downloadCard(catalogCard, { root, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(hit.metadata.cache, "hit");
  assert.equal(calls, 1);
});

test("concurrent image requests share one cache download", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-card-concurrent-test-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return new Response(pngBytes, { status: 200 });
  };
  const catalogCard = toCatalogCard(card({ asset: {
    ...card().asset!,
    size: pngBytes.byteLength,
    sha1hash: sha1(pngBytes)
  } }));
  const results = await Promise.all(Array.from({ length: 20 }, () => acquireCardImage(catalogCard, { cacheDir: root, fetchImpl: fetchImpl as typeof fetch })));
  assert.equal(calls, 1);
  assert.equal(results.every((result) => result.sha256 === results[0]?.sha256), true);
});

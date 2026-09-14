import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchCards } from "../src/source.ts";
import { createCatalogLoader } from "../src/catalog-loader.ts";
import { card } from "./fixtures.ts";

test("cold start without cache fetches once and creates a reusable cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-source-test-"));
  const cachePath = join(root, "cache", "catalog.json");
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return Response.json({ result: [card()] }); };
  const cold = await fetchCards({ cachePath, fetchImpl: fetchImpl as typeof fetch });
  const warm = await fetchCards({ cachePath, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(cold.cache, "miss");
  assert.equal(warm.cache, "hit");
  assert.equal(calls, 1);
});

test("catalog request times out", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-source-timeout-test-"));
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const keepAlive = setTimeout(() => undefined, 50);
  try {
    await assert.rejects(fetchCards({ cachePath: join(root, "catalog.json"), fetchImpl, timeoutMs: 5 }), /timeout/i);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("desktop catalog loader deduplicates concurrent cold starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-catalog-loader-test-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return Response.json({ result: [card()] });
  };
  const loader = createCatalogLoader({ cachePath: join(root, "catalog.json"), fetchImpl: fetchImpl as typeof fetch });
  const results = await Promise.all(Array.from({ length: 12 }, () => loader.load()));
  assert.equal(calls, 1);
  assert.equal(results.every((result) => result.cards.length === 1), true);
});

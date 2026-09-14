import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { toCatalogCard } from "../src/catalog.ts";
import { sha1 } from "../src/downloader.ts";
import { exportBatch, exportCard, exportedMetadata, exportPaths } from "../src/exporter.ts";
import { card } from "./fixtures.ts";
import type { SanityCard } from "../src/source.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const downloadable = (overrides: Partial<SanityCard> = {}) => toCatalogCard(card({ asset: { ...card().asset!, size: png.byteLength, sha1hash: sha1(png) }, ...overrides }));
const response = async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } });

test("flat output path", () => {
  const paths = exportPaths(downloadable(), "C:/export", "flat");
  assert.match(paths.image.replace(/\\/g, "/"), /export\/teal_shell\.png$/);
  assert.match(paths.metadata.replace(/\\/g, "/"), /export\/data\/teal_shell\.json$/);
});

test("by-class output path", () => {
  const paths = exportPaths(downloadable(), "C:/export", "by-class");
  assert.match(paths.image.replace(/\\/g, "/"), /export\/aqua\/teal_shell\.png$/);
  assert.match(paths.metadata.replace(/\\/g, "/"), /export\/data\/aqua\/teal_shell\.json$/);
});

test("duplicate display names retain collision-safe filenames", () => {
  const variants = [
    downloadable({ slug: "nut-cracker", title: "Nut Cracker" }),
    downloadable({ _id: "ears", slug: "nut-cracker-ears", title: "Nut Cracker" }),
    downloadable({ _id: "tail", slug: "nut-cracker-tail", title: "Nut Cracker" })
  ];
  assert.deepEqual(variants.map((item) => item.local_name), ["nut_cracker", "nut_cracker_ears", "nut_cracker_tail"]);
});

test("metadata export contains only real catalog data and hash", () => {
  const metadata = exportedMetadata(downloadable(), "abc123");
  assert.equal(metadata.sanity_id, "id-1");
  assert.equal(metadata.sha256, "abc123");
  assert.equal(metadata.card_type, null);
  assert.equal(metadata.mana, null);
});

test("cache miss downloads and cache hit avoids a second download", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-export-test-"));
  const cacheDir = join(root, "cache");
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(); };
  const first = await exportCard(downloadable(), { exportRoot: join(root, "one"), cacheDir, fetchImpl: fetchImpl as typeof fetch });
  const second = await exportCard(downloadable(), { exportRoot: join(root, "two"), cacheDir, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.equal(calls, 1);
});

test("batch report isolates per-card errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-batch-test-"));
  const good = downloadable();
  const bad = downloadable({ _id: "bad", slug: "bad-card", title: "Bad Card", asset: { ...card().asset!, _id: "bad-asset", url: "https://cdn.example/bad.png", size: png.byteLength, sha1hash: sha1(png) } });
  const fetchImpl = async (input: string | URL | Request) => String(input).includes("bad.png") ? new Response("missing", { status: 404 }) : response();
  const report = await exportBatch([good, bad], {
    exportRoot: join(root, "output"),
    cacheDir: join(root, "cache"),
    layout: "by-class",
    exportMetadata: true,
    filters: { search: "", className: null, part: null },
    fetchImpl: fetchImpl as typeof fetch
  });
  assert.equal(report.total, 2);
  assert.equal(report.success, 1);
  assert.equal(report.failed, 1);
  assert.match(report.cards[1]?.error ?? "", /404/);
  const saved = JSON.parse(await readFile(join(root, "output", "batch_report.json"), "utf8"));
  assert.equal(saved.cards.length, 2);
});

test("existing different output is reported and never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-conflict-test-"));
  const target = exportPaths(downloadable(), root, "flat").image;
  const existing = new Uint8Array([1, 2, 3, 4]);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, existing);
  const result = await exportCard(downloadable(), { exportRoot: root, layout: "flat", cacheDir: join(root, "cache"), fetchImpl: response as typeof fetch });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /conflict/i);
  assert.deepEqual(new Uint8Array(await readFile(target)), existing);
});

test("existing different batch report is never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-report-conflict-test-"));
  const reportPath = join(root, "batch_report.json");
  await writeFile(reportPath, "user-owned report\n");
  const report = await exportBatch([], {
    exportRoot: root,
    layout: "flat",
    exportMetadata: true,
    filters: { search: "", className: null, part: null }
  });
  assert.equal(await readFile(reportPath, "utf8"), "user-owned report\n");
  assert.match(report.report_path.replace(/\\/g, "/"), /batch_report_2\.json$/);
});

test("repeated batch preserves both reports with conflict-safe names", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-report-repeat-test-"));
  const options = {
    exportRoot: root,
    cacheDir: join(root, "cache"),
    layout: "flat" as const,
    exportMetadata: true,
    filters: { search: "", className: null, part: null },
    fetchImpl: response as typeof fetch
  };
  const first = await exportBatch([downloadable()], options);
  const second = await exportBatch([downloadable()], options);
  const third = await exportBatch([downloadable()], options);
  assert.equal(first.success, 1);
  assert.equal(second.skipped, 1);
  assert.match(first.report_path.replace(/\\/g, "/"), /batch_report\.json$/);
  assert.match(second.report_path.replace(/\\/g, "/"), /batch_report_2\.json$/);
  assert.match(third.report_path.replace(/\\/g, "/"), /batch_report_3\.json$/);
  assert.equal(JSON.parse(await readFile(first.report_path, "utf8")).success, 1);
  assert.equal(JSON.parse(await readFile(second.report_path, "utf8")).skipped, 1);
});

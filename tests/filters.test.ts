import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.ts";
import { filterCatalog } from "../src/filters.ts";
import { card } from "./fixtures.ts";

const cards = buildCatalog([
  card(),
  card({ _id: "plant-eyes", title: "Cucumber Slice", slug: "cucumber-slice", class: { _id: "plant", title: "Plant" }, part: { _id: "eyes", title: "Eyes" } })
]);
const filters = { search: "", className: null, part: null };

test("filtering by class", () => assert.deepEqual(filterCatalog(cards, { ...filters, className: "Plant" }).map((item) => item.name), ["Cucumber Slice"]));
test("filtering by part", () => assert.deepEqual(filterCatalog(cards, { ...filters, part: "Horn" }).map((item) => item.name), ["Teal Shell"]));
test("search by display name", () => assert.equal(filterCatalog(cards, { ...filters, search: "teal" })[0]?.id, "id-1"));
test("search by slug", () => assert.equal(filterCatalog(cards, { ...filters, search: "cucumber-slice" })[0]?.id, "plant-eyes"));
test("search by local_name and internal id", () => {
  assert.equal(filterCatalog(cards, { ...filters, search: "cucumber_slice" })[0]?.id, "plant-eyes");
  assert.equal(filterCatalog(cards, { ...filters, search: "plant-eyes" })[0]?.local_name, "cucumber_slice");
});

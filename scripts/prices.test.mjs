import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFile, buildRates, buildSalesFile, ratesMeta, readRates, readSkinport, readSkinportSales, readSteamPage } from "./prices.mjs";

test("reads Skinport like the app", () => {
  const got = readSkinport([
    { market_hash_name: "Kilowatt Case", suggested_price: 0.8, min_price: 0.7 },
    { market_hash_name: "Only listing", min_price: 1.25 },
    { market_hash_name: "Only median", median_price: 3 },
    { market_hash_name: "Nothing" },
    { market_hash_name: "" },
  ]);
  assert.deepEqual(got, { "Kilowatt Case": 80, "Only listing": 125, "Only median": 300 });
  assert.deepEqual(readSkinport(null), {});
});

test("reads a Steam search page", () => {
  const got = readSteamPage({ success: true, total_count: 2, results: [{ hash_name: "AK-47 | Redline (Field-Tested)", sell_price: 1234 }, { hash_name: "Bad", sell_price: 0 }] });
  assert.deepEqual(got, { total: 2, prices: { "AK-47 | Redline (Field-Tested)": 1234 } });
  assert.deepEqual(readSteamPage({ success: false }), { total: null, prices: {} });
});

test("builds the file and keeps yesterday's values for a failed source", () => {
  const first = buildFile({
    now: 100,
    skinport: { USD: { A: 10, B: 20 }, EUR: { A: 9 } },
    steam: { prices: { A: 15, C: 30 }, complete: true },
  });
  assert.deepEqual(first.USD, { A: [15, 10], B: [null, 20], C: [30, null] });
  assert.deepEqual(first.EUR, { A: [null, 9] });
  assert.deepEqual(first.sources.steam, { at: 100, complete: true, error: null, count: 2 });

  // The next day Steam blocks the job and Skinport's EUR call fails.
  const second = buildFile({ now: 200, skinport: { USD: { A: 11 } }, steam: { prices: {}, complete: false, error: "429" }, previous: first });
  assert.deepEqual(second.USD, { A: [15, 11], C: [30, null] });
  assert.deepEqual(second.EUR, { A: [null, 9] });
  assert.equal(second.sources.skinport.USD.at, 200);
  assert.equal(second.sources.skinport.EUR.at, 100, "EUR keeps its old date");
  assert.equal(second.sources.steam.at, 100);
  assert.equal(second.sources.steam.error, "429");
});

test("trims Skinport's sales to what the app reads", () => {
  const got = readSkinportSales([
    {
      market_hash_name: "Kilowatt Case",
      currency: "USD",
      item_page: "https://skinport.com/x",
      last_24_hours: { min: 0.08, max: 0.17, avg: 0.16, median: 0.17, volume: 42 },
      last_7_days: { min: 0.08, max: 0.2, avg: 0.15, median: 0.16, volume: 300 },
      last_30_days: { min: null, max: null, avg: null, median: null, volume: 0 },
    },
    { market_hash_name: "Never sold", last_90_days: { volume: 0 } },
  ]);
  assert.deepEqual(got, [
    {
      market_hash_name: "Kilowatt Case",
      last_24_hours: { min: 0.08, max: 0.17, avg: 0.16, median: 0.17, volume: 42 },
      last_7_days: { min: 0.08, max: 0.2, avg: 0.15, median: 0.16, volume: 300 },
    },
  ]);
});

test("the sales file keeps yesterday's list for a currency that failed", () => {
  const row = { market_hash_name: "A", last_7_days: { median: 1, volume: 5 } };
  const first = buildSalesFile({ now: 100, sales: { USD: [row], EUR: [row] } });
  assert.deepEqual(first.sources, { USD: { at: 100, count: 1 }, EUR: { at: 100, count: 1 } });
  const second = buildSalesFile({ now: 200, sales: { USD: [row], EUR: null }, previous: first });
  assert.equal(second.sources.USD.at, 200);
  assert.equal(second.sources.EUR.at, 100);
  assert.deepEqual(second.EUR, [row]);
});

test("reads ECB rates and keeps yesterday's file when the request fails", () => {
  const rates = readRates({ base: "USD", rates: { "2026-11-09": { EUR: 0.89342 }, "2026-11-06": { EUR: 0.89566 }, bad: { EUR: 1 }, "2026-11-10": { EUR: 0 } } });
  assert.deepEqual(rates, { "2026-11-09": 0.89342, "2026-11-06": 0.89566 });
  assert.deepEqual(readRates({ base: "EUR", rates: { "2026-11-09": { EUR: 1 } } }), {});

  const first = buildRates({ now: 100, rates });
  assert.deepEqual(Object.keys(first.EUR), ["2026-11-06", "2026-11-09"], "oldest first");
  assert.deepEqual(ratesMeta(first), { at: 100, date: "2026-11-09", USD_EUR: 0.89342, count: 2 });

  const second = buildRates({ now: 200, rates: {}, previous: first });
  assert.equal(second.at, 100, "keeps the old date");
  assert.deepEqual(second.EUR, first.EUR);
  assert.equal(buildRates({ now: 200, rates: null }), null);
});

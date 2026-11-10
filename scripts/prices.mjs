// Pure helpers for the daily price file: reading Skinport's and Steam's
// replies and building the file. No network here; fetch-prices.mjs does that.

export const FORMAT_VERSION = 1;

const cents = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null);

/** Skinport `/v1/items` -> { name: cents }. Suggested price, else the lowest listing, else the median (as the app does). */
export function readSkinport(body) {
  const out = {};
  if (!Array.isArray(body)) return out;
  for (const item of body) {
    const name = typeof item?.market_hash_name === "string" ? item.market_hash_name.trim() : "";
    if (!name) continue;
    const lowest = cents(item.min_price);
    const value = cents(item.suggested_price) ?? lowest ?? cents(item.median_price);
    if (value != null && value > 0) out[name] = value;
  }
  return out;
}

/** One Steam `market/search/render?norender=1` page -> { total, prices: { hash_name: cents } } (sell_price is in US cents). */
export function readSteamPage(body) {
  const prices = {};
  if (!body || body.success === false || !Array.isArray(body.results)) return { total: null, prices };
  for (const r of body.results) {
    const name = typeof r?.hash_name === "string" ? r.hash_name : "";
    const price = Number.isInteger(r?.sell_price) && r.sell_price > 0 ? r.sell_price : null;
    if (name && price != null) prices[name] = price;
  }
  return { total: Number.isInteger(body.total_count) ? body.total_count : null, prices };
}

/**
 * The file: per currency, name -> [steam, skinport] in cents (null when that
 * market has none). A source that failed today keeps the previous file's
 * values and date, so the app can tell how old each one is.
 */
export function buildFile({ now, skinport, steam, previous }) {
  const sources = { skinport: {}, steam: null };
  const values = {};
  const put = (currency, name, slot, value) => {
    const row = ((values[currency] ??= {})[name] ??= [null, null]);
    row[slot] = value;
  };
  for (const currency of ["USD", "EUR"]) {
    let fresh = skinport?.[currency];
    let at = now;
    if (!fresh || !Object.keys(fresh).length) {
      fresh = previousColumn(previous, currency, 1);
      at = previous?.sources?.skinport?.[currency]?.at ?? null;
    }
    if (fresh && Object.keys(fresh).length) {
      for (const [name, value] of Object.entries(fresh)) put(currency, name, 1, value);
      sources.skinport[currency] = { at, count: Object.keys(fresh).length };
    }
  }
  let steamPrices = steam?.prices;
  let steamInfo = steam ? { at: now, complete: steam.complete, error: steam.error ?? null } : null;
  if (!steamPrices || !Object.keys(steamPrices).length) {
    steamPrices = previousColumn(previous, "USD", 0);
    const old = previous?.sources?.steam;
    steamInfo = old ? { ...old, error: steam?.error ?? old.error ?? null } : steam ? { at: null, complete: false, error: steam.error ?? null } : null;
  }
  if (steamPrices && Object.keys(steamPrices).length) {
    for (const [name, value] of Object.entries(steamPrices)) put("USD", name, 0, value);
    steamInfo = { ...steamInfo, count: Object.keys(steamPrices).length };
  }
  sources.steam = steamInfo;
  return { version: FORMAT_VERSION, generated_at: now, sources, ...values };
}

function previousColumn(previous, currency, slot) {
  const rows = previous?.version === FORMAT_VERSION ? previous[currency] : null;
  if (!rows) return null;
  const out = {};
  for (const [name, row] of Object.entries(rows)) if (Array.isArray(row) && row[slot] != null) out[name] = row[slot];
  return out;
}

const PERIODS = ["last_24_hours", "last_7_days", "last_30_days", "last_90_days"];
const FIELDS = ["min", "max", "avg", "median", "volume"];

/**
 * Skinport `/v1/sales/history` -> the same shape, trimmed: only items that sold
 * in the last 90 days, only periods with sales, only the fields the app reads.
 * Values stay in Skinport's units, so the app reads them with its usual parser.
 */
export function readSkinportSales(body) {
  if (!Array.isArray(body)) return [];
  const out = [];
  for (const item of body) {
    const name = typeof item?.market_hash_name === "string" ? item.market_hash_name.trim() : "";
    if (!name) continue;
    const row = { market_hash_name: name };
    for (const period of PERIODS) {
      const p = item[period];
      if (!p || !(p.volume > 0)) continue;
      row[period] = Object.fromEntries(FIELDS.filter((f) => typeof p[f] === "number" && Number.isFinite(p[f])).map((f) => [f, p[f]]));
    }
    if (Object.keys(row).length > 1) out.push(row);
  }
  return out;
}

/** The sales file: per currency, Skinport's trimmed sales list; a failed currency keeps yesterday's. */
export function buildSalesFile({ now, sales, previous }) {
  const file = { version: FORMAT_VERSION, generated_at: now, sources: {} };
  for (const currency of ["USD", "EUR"]) {
    let list = sales?.[currency];
    let at = now;
    if (!list?.length && previous?.version === FORMAT_VERSION && Array.isArray(previous[currency])) {
      list = previous[currency];
      at = previous.sources?.[currency]?.at ?? null;
    }
    if (list?.length) {
      file[currency] = list;
      file.sources[currency] = { at, count: list.length };
    }
  }
  return file;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Frankfurter's time series (`base=USD&symbols=EUR`) -> { "YYYY-MM-DD": euros per dollar }. */
export function readRates(body) {
  const out = {};
  const rates = body?.base === "USD" && body.rates && typeof body.rates === "object" ? body.rates : {};
  for (const [day, row] of Object.entries(rates)) {
    const rate = row?.EUR;
    if (DAY.test(day) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) out[day] = rate;
  }
  return out;
}

/**
 * The rates file: every ECB working day's dollar-to-euro rate, oldest first.
 * When today's request fails the previous file is kept as it was.
 */
export function buildRates({ now, rates, previous }) {
  let days = rates && Object.keys(rates).length ? rates : null;
  let at = now;
  if (!days && previous?.version === FORMAT_VERSION && previous.EUR) {
    days = previous.EUR;
    at = previous.at ?? null;
  }
  if (!days) return null;
  const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { version: FORMAT_VERSION, generated_at: now, at, base: "USD", EUR: sorted };
}

/** The rates line in meta.json: the newest day and its rate. */
export function ratesMeta(file) {
  const days = Object.keys(file?.EUR ?? {});
  if (!days.length) return null;
  const date = days[days.length - 1];
  return { at: file.at, date, USD_EUR: file.EUR[date], count: days.length };
}

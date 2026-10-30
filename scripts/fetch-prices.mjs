// Builds the daily price file: Skinport's whole list (USD and EUR) and Steam
// Market's search pages (USD), into out/prices.json.gz and out/meta.json.
// A source that fails keeps yesterday's values (read from out/previous.json.gz).
// Run: node scripts/fetch-prices.mjs   (STEAM_MAX_PAGES limits Steam for a quick test)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildFile, readSkinport, readSteamPage } from "./prices.mjs";

const OUT = "out";
const USER_AGENT = "nodezero-prices (+https://github.com/murathudavendigar/nodezero-prices)";
const SKINPORT_URL = "https://api.skinport.com/v1/items";
const STEAM_URL = "https://steamcommunity.com/market/search/render/";
/** Steam blocks after about 20 requests a minute. */
const STEAM_SPACING_MS = 4000;
const STEAM_PAGE = 100;
const STEAM_MAX_PAGES = Number(process.env.STEAM_MAX_PAGES ?? 600);
/** After a 429 Steam is asked again after this long, a few times, then the run stops. */
const STEAM_LIMIT_WAITS_MS = [60_000, 120_000, 300_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function skinport(currency) {
  try {
    // Skinport asks for Brotli; Node's fetch decodes it.
    const body = await getJson(`${SKINPORT_URL}?app_id=730&currency=${currency}`, { "Accept-Encoding": "br, gzip" });
    const prices = readSkinport(body);
    log(`Skinport ${currency}: ${Object.keys(prices).length} items`);
    return prices;
  } catch (e) {
    log(`Skinport ${currency} failed: ${e.message}`);
    return null;
  }
}

async function steam() {
  const prices = {};
  let total = null;
  let error = null;
  for (let page = 0; page < STEAM_MAX_PAGES; page++) {
    const start = page * STEAM_PAGE;
    if (total != null && start >= total) break;
    const url = `${STEAM_URL}?appid=730&norender=1&count=${STEAM_PAGE}&start=${start}&sort_column=name&sort_dir=asc&search_descriptions=0`;
    let body = null;
    for (let attempt = 0; attempt <= STEAM_LIMIT_WAITS_MS.length; attempt++) {
      try {
        body = await getJson(url);
        break;
      } catch (e) {
        error = e.message;
        const wait = STEAM_LIMIT_WAITS_MS[attempt];
        if (wait == null) break;
        log(`Steam page ${page} failed (${e.message}); waiting ${wait / 1000} s`);
        await sleep(wait);
      }
    }
    if (!body) {
      log(`Steam stopped at page ${page}: ${error}`);
      return { prices, complete: false, error: `Stopped at ${start} of ${total ?? "?"}: ${error}` };
    }
    const read = readSteamPage(body);
    total = read.total ?? total;
    Object.assign(prices, read.prices);
    if (page % 25 === 0) log(`Steam ${start + STEAM_PAGE} of ${total}: ${Object.keys(prices).length} priced`);
    await sleep(STEAM_SPACING_MS);
  }
  const complete = total != null && Object.keys(prices).length > 0;
  log(`Steam done: ${Object.keys(prices).length} priced of ${total}`);
  return { prices, complete, error: complete ? null : error };
}

function previousFile() {
  const path = `${OUT}/previous.json.gz`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  } catch {
    return null;
  }
}

const now = Math.floor(Date.now() / 1000);
mkdirSync(OUT, { recursive: true });
const sp = { USD: await skinport("USD"), EUR: await skinport("EUR") };
const st = process.env.SKIP_STEAM ? null : await steam();
const file = buildFile({ now, skinport: sp, steam: st, previous: previousFile() });
const rows = (c) => Object.keys(file[c] ?? {}).length;
if (!rows("USD") && !rows("EUR")) {
  console.error("No prices from any source and no earlier file: nothing published.");
  process.exit(1);
}
writeFileSync(`${OUT}/prices.json.gz`, gzipSync(JSON.stringify(file), { level: 9 }));
const meta = { version: file.version, generated_at: file.generated_at, sources: file.sources, rows: { USD: rows("USD"), EUR: rows("EUR") } };
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
log("Written", JSON.stringify(meta));

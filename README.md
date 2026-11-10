# nodezero-prices

A daily CS2 price file for [NODEZERO](https://github.com/murathudavendigar/nodezero-releases). One scheduled job fetches the prices once a day, so the app does not have to ask the markets item by item on every player's PC.

## Download

- All prices: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/prices.json.gz
- Skinport sales history: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/sales.json.gz
- ECB dollar-to-euro rates since August 2013: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/rates.json.gz
- Sources and dates only: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/meta.json

## Sources

| Source | What | How often |
| --- | --- | --- |
| [Skinport](https://skinport.com) public API (`/v1/items`, no key) | Suggested price, else lowest listing, else median; USD and EUR | Once a day, 2 requests |
| [Skinport](https://skinport.com) public API (`/v1/sales/history`, no key) | Sales of the last 24 hours, 7, 30 and 90 days (min, max, avg, median, volume); USD and EUR | Once a day, 2 requests |
| Steam Community Market search (`/market/search/render`, no key) | Lowest listing (`sell_price`), USD | Once a day, 100 items a request, 4 s apart. Steam refused GitHub's servers on the first run (2026-10-30, 429 on the first request), so `steam` is usually empty here; the job tries once a day and gives up after one minute. |
| [Frankfurter](https://frankfurter.dev) (`/v1/2013-08-01..?base=USD&symbols=EUR`, no key) | European Central Bank reference rate, euros per dollar, every working day since 2013-08-01 (skins came with the Arms Deal update on 2013-08-14) | Once a day, 1 request |

Prices belong to those markets. This project is not affiliated with Valve or Skinport.

## Format (`version` 1)

```json
{
  "version": 1,
  "generated_at": 1793862000,
  "sources": {
    "skinport": { "USD": { "at": 1793862000, "count": 21000 }, "EUR": { "at": 1793862000, "count": 21000 } },
    "steam": { "at": 1793862000, "complete": true, "error": null, "count": 24000 }
  },
  "USD": { "AK-47 | Redline (Field-Tested)": [1234, 1100] },
  "EUR": { "AK-47 | Redline (Field-Tested)": [null, 1020] }
}
```

Each item is `[steam, skinport]` in cents; `null` when that market has no price. Steam is USD only. When a source fails, the previous day's values stay in the file with their old `at`, so a reader can tell how old each one is.

## Sales file (`sales.json.gz`, `version` 1)

```json
{
  "version": 1,
  "generated_at": 1793862000,
  "sources": { "USD": { "at": 1793862000, "count": 15000 }, "EUR": { "at": 1793862000, "count": 15000 } },
  "USD": [{ "market_hash_name": "Kilowatt Case", "last_7_days": { "min": 0.08, "max": 0.2, "avg": 0.15, "median": 0.16, "volume": 300 } }]
}
```

Skinport's own shape and units, trimmed: only items sold in the last 90 days, only periods with sales. A currency that failed keeps yesterday's list and date.

## Rates file (`rates.json.gz`, `version` 1)

```json
{ "version": 1, "generated_at": 1793862000, "at": 1793862000, "base": "USD", "EUR": { "2013-08-01": 0.75552, "2026-11-09": 0.89342 } }
```

Euros per dollar for every ECB working day (no weekends or holidays: use the day before), oldest first. When the request fails the previous file stays, with its old `at`. `meta.json` has the newest day as `rates: { at, date, USD_EUR, count }`.

## Run

- Every day at 03:17 UTC, or by hand: Actions → Daily prices → Run workflow (`steam_max_pages` limits Steam for a quick test).
- GitHub turns off scheduled workflows after 60 days without commits; each run enables the workflow again so the schedule stays on. A failed run is emailed to the repository owner by GitHub. If the schedule ever stops, Actions → Daily prices → Enable workflow turns it back on.
- Locally: `npm test`, then `npm run fetch` (writes `out/`; `SKIP_STEAM=1` skips Steam).

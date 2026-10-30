# nodezero-prices

A daily CS2 price file for [NODEZERO](https://github.com/murathudavendigar/nodezero-releases). One scheduled job fetches the prices once a day, so the app does not have to ask the markets item by item on every player's PC.

## Download

- All prices: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/prices.json.gz
- Sources and dates only: https://github.com/murathudavendigar/nodezero-prices/releases/download/latest/meta.json

## Sources

| Source | What | How often |
| --- | --- | --- |
| [Skinport](https://skinport.com) public API (`/v1/items`, no key) | Suggested price, else lowest listing, else median; USD and EUR | Once a day, 2 requests |
| Steam Community Market search (`/market/search/render`, no key) | Lowest listing (`sell_price`), USD | Once a day, 100 items a request, 4 s apart |

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

## Run

- Every day at 03:17 UTC, or by hand: Actions → Daily prices → Run workflow (`steam_max_pages` limits Steam for a quick test).
- Locally: `npm test`, then `npm run fetch` (writes `out/`; `SKIP_STEAM=1` skips Steam).

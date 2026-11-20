# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cytoboth/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cytoboth/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which protocol without a token would be worth the most if it launched. Built for
[make.fun](https://make.fun)'s “Build the best token launch radar” bounty.

## What it does

Reads one sealed DefiLlama snapshot (758 protocols, $5M TVL floor) and ranks 200 of them: the 40 that
meet the watchlist rule plus 160 pre-token protocols below it. Every row carries an implied value, an
interquartile band, a launch-odds prior and a farm plan built from that protocol's own record.

## The model

The value curve is fitted at run time on the snapshot's own token-bearing protocols:

```
ln(mcap / TVL) = 6.9646 − 1.1000 · log₁₀(TVL)
```

so implied value scales as `TVL^0.522`. A $2.75B protocol is priced at $71M, a $7M one at $2.6M. A flat
multiple of TVL would overvalue the largest by about 7×.

A per-category multiplier was tested on two held-out halves and rejected: it cost 0.065 of rank
correlation (0.458→0.437 and 0.416→0.307). The folds are printed on the page.

Launch odds come from the share of same-age protocols that already record a token — 2% under six
months, 28% past three years — and are shown beside the value rather than folded into it.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Writes `out/board.json` (200 rows), `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. Node 22.18 or later, standard library only, no network.

## Layout

- `main.ts` — entrypoint: reads the snapshot, scores it, writes the output and the dossier
- `lib/model.ts` — board assembly, ranking, farm plans
- `lib/valuation.ts` — the fit, its bands, the odds table and the category test
- `dashboard/` — the static page: board, filters, detail drawer, method notes
- `vendor/makefun-board.ts` — the kit's dossier writer, unchanged

## Licence

MIT.

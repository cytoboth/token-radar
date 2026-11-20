# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cytoboth/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cytoboth/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which protocol without a token would be worth the most if it launched. Built for
[make.fun](https://make.fun)'s “Build the best token launch radar” bounty.

## What it does

Reads one sealed DefiLlama snapshot (758 protocols, $50M TVL floor) and ranks 200 of them: the 40 that
meet the watchlist rule plus 160 pre-token protocols below it. Every row carries an implied value, a
60% band, a launch-odds prior, and a $1,000 farm economics with six concrete steps.

## The model

The value curve is fitted at run time on the snapshot's own token-bearing protocols, with Huber weights
so the 400× and 69× ratio outliers cannot bend it:

```
ln(mcap / TVL) = 6.4668 − 1.0325 · log₁₀(TVL)
```

so implied value scales as `TVL^0.552`. A $2.75B protocol is priced at $81.8M, a $7M one at about
$3.8M. Five-fold validation on the 128 peers: held-out median miss ×1.16 against ×1.07 for a flat
0.2× TVL cap, 47% of held-out values inside ×3 against 36%, and a 60% interval that holds 59% of the
time. A per-category multiplier was tested on held-out halves and rejected; the folds are printed on
the page.

Launch odds come from the share of same-age protocols that already record a token and are shown beside
the value rather than folded into it. Each row's farm economics models a $1,000 ticket: a 13% airdrop
slice, gas, fees, time, net, break-even drop share, exit trigger and the steps to execute.

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

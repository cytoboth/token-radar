# Launch Radar: what this board does

One sealed DefiLlama snapshot, 758 protocols. The board ranks 200: the 40 on the watchlist plus 160
pre-token protocols below the $50M floor, strongest first.

Value is fitted, not assumed. On the 128 protocols that already trade, a Huber-robust fit gives
ln(mcap/TVL) = 6.4668 − 1.0325·log10(TVL), so implied value scales as TVL^0.552. A $2.75B protocol is
worth $81.8M, a $7M one about $3.8M. The robust fit keeps the snapshot's 400× and 69× ratio outliers
from bending the curve.

Five-fold validation on the 128 peers: held-out median miss ×1.16 against ×1.07 for a flat 0.2× TVL cap,
47% of held-out values inside ×3 against 36%, and a 60% interval that holds 59% of the time. The
per-category term was tested on held-out halves and rejected; the folds are printed on the page.

Each row carries a 60% band, a launch-odds prior fitted as a logistic on age, and a $1,000 farm
economics: modelled airdrop slice, gas, fees, time, net, break-even drop share, exit trigger and six
concrete steps. Every figure is computed from the snapshot alone.

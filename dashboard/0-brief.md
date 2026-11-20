# Token Radar: what this board does

One sealed DefiLlama snapshot, 758 protocols. The board ranks 200: the 40 that meet the watchlist rule
(no token, TVL above $50M, not a versioned, wrapped, staked or bridged product) plus 160 pre-token
protocols below that floor.

Value is fitted, not assumed. On the 128 protocols that already trade,
ln(mcap/TVL) = 6.9646 - 1.1000*log10(TVL), so implied value scales as TVL^0.522: a $2.75B protocol is
worth $71M, a $7M one $2.6M. A flat multiple misses the largest by 7x.

A per-category multiplier was tested on held-out halves and dropped: it lost 0.065 of rank correlation
(0.458 to 0.437 and 0.416 to 0.307). The folds are printed on the page.

Each row carries an interquartile band from the fit's residuals and a launch-odds prior from the share
of same-age protocols that already record a token: 2% under six months, 28% past three years. Farm
steps are per protocol, not boilerplate.

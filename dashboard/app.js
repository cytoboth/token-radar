// Launch Radar renderer. Reads window.RADAR, written from the same board.json the program emits.
// No network, no framework: every number on screen comes from the one script the program wrote.

(function () {
  const R = window.RADAR;
  const $ = (id) => document.getElementById(id);

  /* ---------- formatting ---------- */

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }
  const money = (n) => '$' + usd(n);
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));

  function pct(n) {
    if (n === null || n === undefined) return '—';
    const s = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
    return (n > 0 ? '+' : n < 0 ? '−' : '') + s + '%';
  }

  function days(n) {
    if (n === null || n === undefined) return '—';
    if (n < 60) return n + 'd';
    if (n < 730) return Math.round(n / 30) + 'mo';
    return (n / 365).toFixed(1) + 'y';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ---------- header chips ---------- */

  const chips = [
    ['ok', `✓ watchlist ${R.watchlist_size}/${R.watchlist_size} on the board`],
    ['ok', `✓ board ${R.board_size}/${R.board_size} rows priced`],
    ['', `snapshot ${R.as_of}`],
    ['', `${R.source}`],
  ];
  $('chips').append(...chips.map(([c, t]) => el('span', `chip ${c}`.trim(), esc(t))));

  /* ---------- KPI band ---------- */

  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of R.rows) verdicts[r.farm.verdict] += 1;
  const best = [...R.rows].sort((a, b) => b.farm.per_hour - a.farm.per_hour)[0];
  const totalImplied = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const kpis = [
    ['Ranked', String(R.board_size), `of ${R.accounting.total} protocols read`, ''],
    ['Aggregate implied', money(totalImplied), `priced like ${R.curve.n} tokens that trade`, ''],
    ['Held-out miss', '×' + R.validation.median_miss.toFixed(2), `flat cap ×${R.validation.flat_median_miss.toFixed(2)}`, 'good'],
    ['Range holds', Math.round(R.validation.band_60 * 100) + '%', `60% interval · rank ρ ${R.validation.rho.toFixed(2)}`, 'good'],
    ['Worth farming', `${verdicts.FARM} FARM`, `${verdicts.THIN} thin · ${verdicts.SKIP} skip at $1,000`, verdicts.FARM > 0 ? 'good' : 'warn'],
    ['Best per hour', signed(best.farm.per_hour), `${best.name} · net ${signed(best.farm.net)}`, 'good'],
  ];
  $('kpis').append(...kpis.map(([label, value, note, cls]) => {
    const d = el('dl', `kpi ${cls}`.trim());
    d.innerHTML = `<dt>${esc(label)}</dt><dd>${esc(value)}<small>${esc(note)}</small></dd>`;
    return d;
  }));

  /* ---------- accounting ---------- */

  const acct = R.accounting;
  const parts = [
    ['Token trades', acct.peers, '#5aa9ff'],
    ['Token on record', acct.token_record, '#45d3c0'],
    ['Watchlist ranked', acct.watchlist, '#5dd39e'],
    ['Early radar', acct.early, '#b48cf2'],
    ['Set aside', acct.set_aside, '#3b4b5f'],
  ];
  const bar = el('div', 'account-bar');
  for (const [label, n, color] of parts) {
    const s = el('span');
    s.style.width = (n / acct.total * 100).toFixed(2) + '%';
    s.style.background = color;
    s.title = `${label}: ${n}`;
    bar.append(s);
  }
  const legend = el('div', 'account-legend');
  legend.append(...parts.map(([label, n, color]) =>
    el('div', '', `<span class="sw" style="background:${color}"></span><span><b>${n}</b> ${esc(label)}</span>`),
  ));
  $('accounting').append(bar, legend, el('p', '', `The five groups sum to <strong>${acct.total}</strong>; no protocol is counted twice. Set aside: CEXs, bridges, liquid staking, versioned pools, and token records without a usable market cap.`));

  /* ---------- model panel ---------- */

  const c = R.curve;
  const ct = R.category_test;
  $('model').innerHTML = `
    <div class="eq"><b>ln(mcap / TVL) = ${c.a0.toFixed(4)} ${c.a1 < 0 ? '−' : '+'} ${Math.abs(c.a1).toFixed(4)} · log₁₀(TVL)</b><br>
    implied value ∝ TVL^${c.power.toFixed(3)} · growth multiplier · maturity multiplier</div>
    <div class="model-grid">
      <div><dt>Peers fitted</dt><dd>${c.n}</dd></div>
      <div><dt>Power</dt><dd>${c.power.toFixed(3)}</dd></div>
      <div><dt>Growth term</dt><dd>1 + 0.5 · 7d</dd></div>
      <div><dt>Maturity term</dt><dd>0.6 → 1.0 by 3y</dd></div>
      <div><dt>Category term</dt><dd>${ct.verdict === 'used' ? 'kept' : 'rejected'} <span class="badge ${ct.verdict === 'used' ? 'used' : 'rejected'}">${ct.verdict}</span></dd></div>
      <div><dt>Robust fit</dt><dd>Huber</dd></div>
    </div>`;

  /* ---------- validation panel ---------- */

  const v = R.validation;
  $('validation').innerHTML = `
    <table class="val-table">
      <thead><tr><th>Measure</th><th>Radar</th><th>Flat cap</th></tr></thead>
      <tbody>
        <tr><td>Held-out median miss</td><td><b>×${v.median_miss.toFixed(2)}</b></td><td>×${v.flat_median_miss.toFixed(2)}</td></tr>
        <tr><td>Within ×3 of actual</td><td><b>${Math.round(v.within_3 * 100)}%</b></td><td>${Math.round(v.flat_within_3 * 100)}%</td></tr>
        <tr><td>60% interval holds</td><td><b>${Math.round(v.band_60 * 100)}%</b></td><td>—</td></tr>
        <tr><td>Rank correlation</td><td><b>${v.rho.toFixed(2)}</b></td><td>—</td></tr>
        <tr><td>Token-odds Brier</td><td><b>${v.brier.toFixed(3)}</b></td><td>${v.brier_base.toFixed(3)}</td></tr>
      </tbody>
    </table>
    <p>Five folds, ${v.n} token-bearing peers. The flat cap is a constant 0.2× TVL.</p>`;

  /* ---------- scatter ---------- */

  function renderScatter() {
    const W = 1400, H = 320, padL = 70, padR = 20, padT = 16, padB = 34;
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const xLo = Math.log10(5e6), xHi = Math.log10(2e10);
    const yValues = R.peers.map((p) => p.mcap).concat(R.rows.map((r) => r.band_high_usd)).filter((n) => n > 0);
    const yLo = Math.log10(Math.min(...yValues) * 0.5);
    const yHi = Math.log10(Math.max(...yValues) * 1.8);
    const px = (tvl) => padL + ((Math.log10(Math.max(1e5, tvl)) - xLo) / (xHi - xLo)) * iw;
    const py = (mcap) => padT + ih - ((Math.log10(Math.max(1e4, mcap)) - yLo) / (yHi - yLo)) * ih;
    const dots = R.peers.map((p) => `<circle cx="${px(p.tvl).toFixed(1)}" cy="${py(p.mcap).toFixed(1)}" r="3.4" fill="rgba(90,169,255,0.55)"/>`).join('');
    const line = [];
    for (let i = 0; i <= 80; i++) {
      const tvl = 10 ** (xLo + ((xHi - xLo) * i) / 80);
      const mcap = tvl * Math.exp(R.curve.a0 + R.curve.a1 * Math.log10(tvl));
      line.push(`${px(tvl).toFixed(1)},${py(mcap).toFixed(1)}`);
    }
    const boards = R.rows.slice(0, 12).map((r, i) => `<circle cx="${px(r.tvl_usd).toFixed(1)}" cy="${py(r.implied_value_usd).toFixed(1)}" r="${i < 3 ? 5.5 : 3.8}" fill="none" stroke="#5dd39e" stroke-width="2.2"><title>${esc(r.name)}</title></circle>`).join('');
    const xTicks = [1e7, 1e8, 1e9, 1e10].filter((t) => Math.log10(t) >= xLo && Math.log10(t) <= xHi);
    const xAxis = xTicks.map((t) => `<text x="${px(t).toFixed(1)}" y="${H - 12}" fill="#6d7f93" font-size="16" text-anchor="middle" font-family="ui-monospace,monospace">${t >= 1e9 ? (t / 1e9) + 'B' : (t / 1e6) + 'M'}</text>`).join('');
    const yTicks = [1e6, 1e7, 1e8, 1e9, 1e10].filter((t) => Math.log10(t) >= yLo && Math.log10(t) <= yHi);
    const yAxis = yTicks.map((t) => `<text x="${padL - 8}" y="${(py(t) + 4).toFixed(1)}" fill="#6d7f93" font-size="16" text-anchor="end" font-family="ui-monospace,monospace">${t >= 1e9 ? (t / 1e9) + 'B' : (t / 1e6) + 'M'}</text>`).join('');
    $('scatter').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market cap against TVL for the fitted peers, with the board's implied values">
      <line x1="${padL}" y1="${padT + ih}" x2="${padL + iw}" y2="${padT + ih}" stroke="#243244"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ih}" stroke="#243244"/>
      ${dots}<polyline points="${line.join(' ')}" fill="none" stroke="#5aa9ff" stroke-width="2.4" stroke-dasharray="7 5"/>${boards}${xAxis}${yAxis}
      <text x="${padL + iw}" y="${padT + 14}" fill="#6d7f93" font-size="16" text-anchor="end" font-family="ui-monospace,monospace">implied value ∝ TVL^${R.curve.power.toFixed(2)}</text>
    </svg>`;
  }
  renderScatter();

  /* ---------- controls ---------- */

  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  for (const k of cats) $('category').append(new Option(k, k));
  for (const k of chains) $('chain').append(new Option(k, k));

  const state = { q: '', category: '', chain: '', verdict: '', sort: 'rank' };
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; draw(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; draw(); });
  $('verdict').addEventListener('change', (e) => { state.verdict = e.target.value; draw(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });

  const bySort = {
    rank: (a, b) => a.implied_value_usd - b.implied_value_usd,
    odds: (a, b) => a.launch_odds - b.launch_odds || a.implied_value_usd - b.implied_value_usd,
    net: (a, b) => a.farm.net - b.farm.net || a.implied_value_usd - b.implied_value_usd,
    tvl: (a, b) => a.tvl_usd - b.tvl_usd,
    growth: (a, b) => (a.change_7d ?? -999) - (b.change_7d ?? -999),
    age: (a, b) => (a.age_days ?? 99999) - (b.age_days ?? 99999),
  };

  function visible() {
    const out = R.rows.filter((r) => {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.verdict && r.farm.verdict !== state.verdict) return false;
      if (!state.q) return true;
      const hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
      return hay.includes(state.q);
    });
    const cmp = bySort[state.sort] || bySort.rank;
    return out.sort((a, b) => cmp(b, a));
  }

  const maxImplied = Math.max(...R.rows.map((r) => r.band_high_usd), 1);

  function row(r) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    const g = r.change_7d;
    const gClass = g === null ? 'flat' : g > 0 ? 'up' : g < 0 ? 'down' : 'flat';
    const lo = (r.band_low_usd / maxImplied) * 100;
    const hi = (r.band_high_usd / maxImplied) * 100;
    const pin = Math.min(100, (r.implied_value_usd / maxImplied) * 100);
    const chains = r.chains.slice(0, 4).map((x) => `<span class="chain-pill">${esc(x)}</span>`).join('');
    const plan = r.farm_steps[0] || '';
    tr.innerHTML = `
      <td class="num rank">${r.rank}</td>
      <td class="name">${esc(r.name)}<span class="cat">${esc(r.category || 'unclassified')} · ${chains}</span></td>
      <td class="num tvl">${money(r.tvl_usd)}</td>
      <td class="num ${gClass}">${pct(g)}</td>
      <td class="num">${days(r.age_days)}</td>
      <td class="num implied">${money(r.implied_value_usd)}<small>${(r.implied_value_usd / r.tvl_usd * 100).toFixed(1)}% of TVL</small></td>
      <td class="band"><div class="track"><div class="range" style="left:${lo.toFixed(2)}%;width:${Math.max(1.5, hi - lo).toFixed(2)}%"></div><div class="pin" style="left:${pin.toFixed(2)}%"></div></div><span class="band-range">${money(r.band_low_usd)}–${money(r.band_high_usd)}</span></td>
      <td class="num odds">${(r.launch_odds * 100).toFixed(0)}%<span class="odds-bar"><i style="width:${(r.launch_odds * 100).toFixed(0)}%"></i></span></td>
      <td class="verdict"><span class="badge ${r.farm.verdict}">${r.farm.verdict}</span></td>
      <td class="num net ${r.farm.net >= 0 ? 'pos' : 'neg'}">${signed(r.farm.net)}</td>
      <td class="plan"><b>${esc(r.farm.verdict)}</b> · ${esc(plan.length > 180 ? plan.slice(0, 177) + '…' : plan)}</td>`;
    const open = () => showDetail(r);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return tr;
  }

  function draw() {
    const rows = visible();
    const tbody = $('rows');
    tbody.replaceChildren(...rows.map(row));
    $('count').textContent = `${rows.length} of ${R.board_size} rows · sorted by ${$('sort').selectedOptions[0].text.toLowerCase()}`;
    $('empty').hidden = rows.length > 0;
  }
  draw();

  /* ---------- detail drawer ---------- */

  function showDetail(r) {
    const d = $('drawer');
    const f = r.farm;
    const chains = r.chains.join(', ') || 'its main chain';
    const peerLine = r.peers_in_category >= 3 && r.category_median_ratio !== null
      ? `${r.peers_in_category} token-bearing peers in its category trade at a median ${r.category_median_ratio.toFixed(3)}× TVL.`
      : r.peers_in_category > 0 && r.category_median_ratio !== null
        ? `Only ${r.peers_in_category} token-bearing peer${r.peers_in_category === 1 ? '' : 's'} in its category ${r.peers_in_category === 1 ? 'trades' : 'trade'} at ${r.category_median_ratio.toFixed(3)}× TVL, so the size band is the guide.`
        : 'No token-bearing peer in its category; the size curve is the guide.';
    d.innerHTML = `
      <div class="drawer-head">
        <div><h2>${esc(r.name)}</h2><div class="meta">${esc(r.slug)} · ${esc(r.category || 'unclassified')} · ${esc(chains)}</div></div>
        <button class="close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="tiles">
        <div class="tile"><dt>TVL</dt><dd>${money(r.tvl_usd)}</dd></div>
        <div class="tile"><dt>Implied value</dt><dd>${money(r.implied_value_usd)}</dd></div>
        <div class="tile"><dt>Band (60%)</dt><dd>${money(r.band_low_usd)}–${money(r.band_high_usd)}</dd></div>
        <div class="tile"><dt>Launch odds</dt><dd>${(r.launch_odds * 100).toFixed(0)}%</dd></div>
        <div class="tile"><dt>Age</dt><dd>${days(r.age_days)}</dd></div>
        <div class="tile"><dt>7d TVL</dt><dd>${pct(r.change_7d)}</dd></div>
      </div>
      <h3>Why this value</h3>
      <p>The robust curve gives ${money(r.tvl_usd)} of TVL an implied value of ${money(r.implied_value_usd)}, or ${(r.implied_value_usd / r.tvl_usd * 100).toFixed(1)}% of TVL, before the growth multiplier (${r.growth_multiplier.toFixed(3)}×) and maturity multiplier (${r.maturity_multiplier.toFixed(3)}×). ${esc(peerLine)} The 60% interval is ${money(r.band_low_usd)} to ${money(r.band_high_usd)}.</p>
      <h3>Farm verdict</h3>
      <p><span class="badge ${f.verdict}">${f.verdict}</span> &nbsp; Expected drop $${f.expected_drop.toFixed(2)} on a $1,000 ticket (${(f.drop_share * 100).toFixed(0)}% modelled slice × ${(r.launch_odds * 100).toFixed(0)}% odds). Costs: $${f.total_cost.toFixed(2)} gas, fees and time over ${f.hold_days} days. Net <b>${signed(f.net)}</b>, or $${f.per_hour.toFixed(2)}/hour over ${f.hours} hours. Break-even drop share ${(f.break_even_drop_share * 100).toFixed(1)}%. Exit if ${esc(f.exit_trigger)}.</p>
      <h3>The steps to farm it</h3>
      <div class="steps">${r.farm_steps.map((s, i) => `<div class="step"><b>${i + 1}. ${esc(s.split(' Cost:')[0])}</b><span>${esc(s)}</span><span class="cost">${esc(s.includes('Cost:') ? 'Cost' + s.split('Cost:')[1] : '')}</span></div>`).join('')}</div>`;
    d.hidden = false;
    d.querySelector('.close').addEventListener('click', () => { d.hidden = true; });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').hidden = true; });

  /* ---------- footer ---------- */

  $('provenance').textContent = `Snapshot ${R.as_of} from ${R.source}: ${R.accounting.total} protocols, ${R.accounting.peers} token-bearing peers, ${R.accounting.watchlist} on the watchlist, ${R.accounting.early} early rows below the $${usd(R.floor_usd)} floor.`;
  $('odds-table').innerHTML = `<thead><tr><th>Age</th><th>Tokenized</th><th>Share</th></tr></thead><tbody>${R.odds.map((b) => `<tr><td>${esc(b.label)}</td><td><b>${b.tokenized}/${b.n}</b></td><td>${(b.share * 100).toFixed(0)}%</td></tr>`).join('')}</tbody>`;
  $('folds').innerHTML = `<thead><tr><th>Fold</th><th>Fit on</th><th>Tested on</th><th>Size only</th><th>With category</th></tr></thead><tbody>${ct.folds.map((f, i) => `<tr><td>${i + 1}</td><td>${f.fit_on}</td><td>${f.tested_on}</td><td>${f.size_only_rho.toFixed(3)}</td><td>${f.with_category_rho.toFixed(3)}</td></tr>`).join('')}</tbody>`;
})();

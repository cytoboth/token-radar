// The board's renderer. Reads window.RADAR (written from the same board.json) and draws the page.
// No network, no framework, no fetch: everything on screen comes from the one script the program wrote.

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

  function pct(n) {
    if (n === null || n === undefined) return '—';
    const s = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
    return (n > 0 ? '+' : '') + s + '%';
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

  /* ---------- header ---------- */

  const totalImplied = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);

  function kpi(label, value, note) {
    const d = document.createElement('div');
    d.innerHTML = `<dt>${esc(label)}</dt><dd>${value}${note ? ` <small>${esc(note)}</small>` : ''}</dd>`;
    return d;
  }

  const kpis = $('kpis');
  kpis.append(
    kpi('Pre-token watchlist', String(R.watchlist_size), 'above the floor'),
    kpi('Ranked rows', String(R.board_size), 'whole universe'),
    kpi('Aggregate implied', money(totalImplied), 'all rows'),
    kpi('Tokens trading', String(R.live_size), 'set aside'),
  );

  /* ---------- model strip ---------- */

  const c = R.curve;
  const ct = R.category_test;
  const strip = $('model');
  strip.innerHTML = `
    <div>
      <div class="eq"><b>ln(mcap / TVL) = ${c.a0.toFixed(4)} ${c.a1 < 0 ? '−' : '+'} ${Math.abs(c.a1).toFixed(4)} · log₁₀(TVL)</b>
implied value ∝ TVL^${c.power.toFixed(3)} — fitted on the snapshot's own token-bearing protocols</div>
    </div>
    <div class="cell"><dl><dt>Peers fitted</dt><dd>${c.n}</dd></dl></div>
    <div class="cell"><dl><dt>R² (level)</dt><dd>${c.r2.toFixed(3)}</dd></dl></div>
    <div class="cell"><dl><dt>Band (IQR, log)</dt><dd>${c.q25.toFixed(2)} … +${c.q75.toFixed(2)}</dd></dl></div>
    <div class="cell"><dl><dt>Category term</dt><dd>${ct.verdict === 'used' ? 'kept' : 'dropped'}
      <span class="badge ${ct.verdict === 'used' ? 'used' : 'rejected'}">${ct.verdict}</span></dd></dl></div>`;

  /* ---------- controls ---------- */

  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  for (const k of cats) $('category').append(new Option(k, k));
  for (const k of chains) $('chain').append(new Option(k, k));

  const state = { q: '', category: '', chain: '', odds: 0, sort: 'rank' };

  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; draw(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; draw(); });
  $('odds').addEventListener('change', (e) => { state.odds = Number(e.target.value); draw(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });

  /* ---------- the board ---------- */

  const bySort = {
    rank: (a, b) => a.implied_value_usd - b.implied_value_usd,
    odds: (a, b) => a.launch_odds - b.launch_odds || a.implied_value_usd - b.implied_value_usd,
    tvl: (a, b) => a.tvl_usd - b.tvl_usd,
    growth: (a, b) => (a.change_7d ?? -999) - (b.change_7d ?? -999),
    age: (a, b) => (a.age_days ?? 99999) - (b.age_days ?? 99999),
  };

  function visible() {
    const out = R.rows.filter((r) => {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (r.launch_odds < state.odds) return false;
      if (!state.q) return true;
      const hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
      return hay.includes(state.q);
    });
    // highest first for the descending sorts, lowest first for age/growth-by-size
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
    const oddsLow = r.launch_odds < 0.25 ? ' low' : '';
    tr.innerHTML = `
      <td class="num rank">${r.rank}</td>
      <td class="name">${esc(r.name)}<span class="cat">${esc(r.category || 'unclassified')} · ${r.chains.slice(0, 3).map((x) => `<span class="chain-pill">${esc(x)}</span>`).join('')}</span></td>
      <td class="num tvl">${money(r.tvl_usd)}</td>
      <td class="num ${gClass}">${pct(g)}</td>
      <td class="num">${days(r.age_days)}</td>
      <td class="num implied">${money(r.implied_value_usd)}<small>${(r.implied_value_usd / r.tvl_usd * 100).toFixed(1)}% of TVL</small></td>
      <td class="band">
        <div class="track"><div class="range" style="left:${lo.toFixed(2)}%;width:${Math.max(1.5, hi - lo).toFixed(2)}%"></div><div class="pin" style="left:${pin.toFixed(2)}%"></div></div>
        <div class="band-label">${money(r.band_low_usd)} – ${money(r.band_high_usd)}</div>
      </td>
      <td class="num odds${oddsLow}">${(r.launch_odds * 100).toFixed(0)}%<span class="odds-bar"><i style="width:${(r.launch_odds * 100).toFixed(0)}%"></i></span></td>`;
    const open = () => showDetail(r);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return tr;
  }

  function draw() {
    const rows = visible();
    const body = $('rows');
    body.replaceChildren(...rows.map(row));
    $('empty').hidden = rows.length > 0;
    $('count').textContent = `${rows.length} of ${R.board_size} rows · sorted by ${$('sort').selectedOptions[0].text.toLowerCase()}`;
  }

  /* ---------- detail drawer ---------- */

  const drawer = $('drawer');
  let lastFocus = null;

  function showDetail(r) {
    lastFocus = document.activeElement;
    const share = ((r.implied_value_usd / totalImplied) * 100).toFixed(2);
    const vsCategory = r.category_median_ratio === null
      ? 'no token-bearing peer in this category'
      : `${r.category_median_ratio.toFixed(3)}× TVL across ${r.peers_in_category} peers`;
    drawer.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <h2>${esc(r.name)}</h2>
      <p class="sub">${esc(r.slug)} · ${esc(r.category || 'unclassified')} · ${esc(r.chains.join(', '))}</p>
      <div class="grid2">
        <dl class="stat"><dt>TVL</dt><dd>${money(r.tvl_usd)}</dd></dl>
        <dl class="stat"><dt>Implied value</dt><dd>${money(r.implied_value_usd)}</dd></dl>
        <dl class="stat"><dt>Band (interquartile)</dt><dd>${money(r.band_low_usd)}–${money(r.band_high_usd)}</dd></dl>
        <dl class="stat"><dt>Share of the board</dt><dd>${share}%</dd></dl>
        <dl class="stat"><dt>Launch odds</dt><dd>${(r.launch_odds * 100).toFixed(0)}%</dd></dl>
        <dl class="stat"><dt>Age</dt><dd>${days(r.age_days)}${r.listed_at ? ` <small style="color:#7d8b9e">since ${esc(r.listed_at)}</small>` : ''}</dd></dl>
        <dl class="stat"><dt>7d TVL change</dt><dd>${pct(r.change_7d)}</dd></dl>
        <dl class="stat"><dt>Category peers</dt><dd>${esc(vsCategory)}</dd></dl>
      </div>
      <h3>Why this value</h3>
      <p style="color:#cfd8e5;font-size:13px;margin:0">
        The curve gives ${money(r.tvl_usd)} of TVL an implied value of ${money(r.implied_value_usd)}
        (${(r.implied_value_usd / r.tvl_usd * 100).toFixed(1)}% of TVL), then the growth term
        (${r.growth_multiplier.toFixed(3)}×) and the maturity term (${r.maturity_multiplier.toFixed(3)}×) adjust it.
        The band is the same curve with the residual quartiles applied, so half the token-bearing peers
        land inside it.
      </p>
      <h3>The steps to farm it</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    drawer.hidden = false;
    drawer.querySelector('.close').addEventListener('click', closeDetail);
    drawer.querySelector('.close').focus();
  }

  function closeDetail() {
    drawer.hidden = true;
    drawer.replaceChildren();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDetail(); });

  /* ---------- footnotes ---------- */

  $('provenance').innerHTML = `Snapshot <code>${esc(R.as_of)}</code>, ${esc(R.source)}. Floor ${money(R.floor_usd)}.
    The board covers all ${R.watchlist_size} watchlist slugs and adds ${R.early_size} pre-token protocols below the
    floor, ranked together.`;

  $('odds-table').innerHTML = `
    <tr><th>Age</th><th>With a token</th><th>Records</th><th>Share</th></tr>
    ${R.odds.map((o) => `<tr><td>${esc(o.label)}</td><td>${o.tokenized}</td><td>${o.n}</td><td>${(o.share * 100).toFixed(1)}%</td></tr>`).join('')}`;

  $('folds').innerHTML = `
    <tr><th>Fit on</th><th>Tested on</th><th>Size only</th><th>+ category</th></tr>
    ${ct.folds.map((f) => `<tr><td>${f.fit_on}</td><td>${f.tested_on}</td><td>${f.size_only_rho.toFixed(3)}</td><td>${f.with_category_rho.toFixed(3)}</td></tr>`).join('')}
    <tr><td colspan="2">mean change</td><td colspan="2">${ct.mean_delta > 0 ? '+' : ''}${ct.mean_delta.toFixed(3)} → ${esc(ct.verdict)}</td></tr>`;

  draw();
})();

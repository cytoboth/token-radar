// The valuation layer: every number the board shows is fitted from the snapshot's own
// token-bearing protocols, not assumed. Kept apart from model.ts so the fit, its bands and its
// rejections can be read on their own.

import type { SnapshotProtocol } from './model.ts';

const LN10 = Math.LN10;

/** A protocol that already trades: the only records that can say what a token is worth. */
export interface Peer {
  slug: string;
  tvl: number;
  mcap: number;
  category: string | null;
  ratio: number;
}

/** The fitted curve and everything needed to show its uncertainty. */
export interface Curve {
  /** ln(mcap/TVL) = a0 + a1 * log10(TVL) */
  a0: number;
  a1: number;
  /** peers the fit used */
  n: number;
  /** coefficient of determination, for the page's method note */
  r2: number;
  /** residual quantiles in log space: the band around a fitted value */
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  /** value ~ TVL^power, the shape the page states in words */
  power: number;
  /** ratio the curve gives at a round TVL, for the page's table */
  at: (tvl: number) => number;
}

export function peersOf(protocols: SnapshotProtocol[]): Peer[] {
  const out: Peer[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    out.push({
      slug: p.slug,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
      category: p.category,
      ratio: p.mcap_usd / p.tvl_usd,
    });
  }
  return out;
}

/** Median absolute value. */
function medianAbs(values: number[]): number {
  const s = values.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Quantile of an ascending-sorted array, by linear interpolation. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * Robust least squares of ln(ratio) on log10(TVL), Huber weights. The snapshot's ratio has
 * extreme outliers (a prediction market at 400x, a CEX at 69x); an ordinary fit lets them
 * bend the curve. The robust fit is the one the board prices with.
 */
export function fitCurveRobust(peers: Peer[]): Curve {
  const usable = peers.filter((p) => p.tvl > 0 && p.ratio > 0);
  const n = usable.length;
  if (n < 12) {
    const a0 = Math.log(0.2);
    return {
      a0, a1: 0, n, r2: 0, q10: -1, q25: -0.7, q75: 0.7, q90: 1,
      power: 1, at: (tvl: number) => Math.exp(a0) * tvl,
    };
  }
  const xs = usable.map((p) => Math.log10(p.tvl));
  const ys = usable.map((p) => Math.log(p.ratio));
  let a0 = 0;
  let a1 = 0;
  let w = new Array<number>(n).fill(1);
  for (let iter = 0; iter < 60; iter++) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sw += w[i]!;
      sx += w[i]! * xs[i]!;
      sy += w[i]! * ys[i]!;
    }
    const mx = sx / sw;
    const my = sy / sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += w[i]! * (xs[i]! - mx) ** 2;
      sxy += w[i]! * (xs[i]! - mx) * (ys[i]! - my);
    }
    if (sxx <= 0) break;
    a1 = sxy / sxx;
    a0 = my - a1 * mx;
    const res = ys.map((y, i) => y - (a0 + a1 * xs[i]!));
    const scale = 1.4826 * medianAbs(res) || 1;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.abs(res[i]!);
      const next = r <= 1.345 * scale ? 1 : (1.345 * scale) / r;
      if (Math.abs(next - w[i]!) > 1e-6) changed++;
      w[i] = next;
    }
    if (changed === 0) break;
  }

  const resid: number[] = [];
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (a0 + a1 * xs[i]!);
    resid.push(r);
    ssRes += r * r;
  }
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const d = ys[i]! - meanY;
    ssTot += d * d;
  }
  resid.sort((a, b) => a - b);

  return {
    a0,
    a1,
    n,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    q10: quantile(resid, 0.1),
    q25: quantile(resid, 0.25),
    q75: quantile(resid, 0.75),
    q90: quantile(resid, 0.9),
    power: 1 + a1 / LN10,
    at: (tvl: number) => Math.exp(a0 + a1 * Math.log10(Math.max(1, tvl))),
  };
}

/**
 * Least squares of ln(ratio) on log10(TVL). Two terms, closed form: the normal equations are 2x2.
 * Returns the identity curve (a0 = ln 0.2, a1 = 0) when there are too few peers to fit.
 */
export function fitCurve(peers: Peer[]): Curve {
  const usable = peers.filter((p) => p.tvl > 0 && p.ratio > 0);
  const n = usable.length;
  if (n < 12) {
    const a0 = Math.log(0.2);
    return {
      a0, a1: 0, n, r2: 0, q10: -1, q25: -0.7, q75: 0.7, q90: 1,
      power: 1, at: (tvl: number) => Math.exp(a0) * tvl,
    };
  }
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of usable) {
    const x = Math.log10(p.tvl);
    const y = Math.log(p.ratio);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const det = n * sxx - sx * sx;
  const a0 = (sy * sxx - sx * sxy) / det;
  const a1 = (n * sxy - sx * sy) / det;

  const resid: number[] = [];
  let ssRes = 0;
  for (const p of usable) {
    const r = Math.log(p.ratio) - (a0 + a1 * Math.log10(p.tvl));
    resid.push(r);
    ssRes += r * r;
  }
  const meanY = sy / n;
  let ssTot = 0;
  for (const p of usable) {
    const d = Math.log(p.ratio) - meanY;
    ssTot += d * d;
  }
  resid.sort((a, b) => a - b);

  return {
    a0,
    a1,
    n,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    q10: quantile(resid, 0.1),
    q25: quantile(resid, 0.25),
    q75: quantile(resid, 0.75),
    q90: quantile(resid, 0.9),
    // ratio ~ TVL^(a1/ln10), so value ~ TVL^(1 + a1/ln10)
    power: 1 + a1 / LN10,
    at: (tvl: number) => Math.exp(a0 + a1 * Math.log10(Math.max(1, tvl))),
  };
}

/** The value the curve gives a protocol of `tvl` before any growth or maturity term. */
export function curveValue(tvl: number, curve: Curve): number {
  return Math.max(1, tvl * curve.at(tvl));
}

/** The band around a fitted value: same curve, residual quantiles applied multiplicatively. */
export function band(value: number, curve: Curve): { low: number; high: number } {
  return {
    low: Math.max(1, Math.round(value * Math.exp(curve.q25))),
    high: Math.max(1, Math.round(value * Math.exp(curve.q75))),
  };
}

/**
 * Launch odds. The share of protocols of a given age that already record a token, fitted as a
 * logistic curve on the snapshot's own records so the prior moves smoothly with age instead of
 * snapping between buckets:
 *   P(token) = 1 / (1 + exp(-(b0 + b1 * ln(age + 1))))
 * It is a cross-sectional rate, not a forecast.
 */
export interface OddsModel {
  /** ascending bucket edges in days, the last open-ended */
  edges: number[];
  /** smoothed share per bucket, for the table on the page */
  shares: number[];
  /** logistic coefficients, for the page's method note */
  b0: number;
  b1: number;
  /** records the fit used */
  n: number;
  /** share for an age in days */
  at: (ageDays: number | null) => number;
  /** the buckets and their raw counts, for the page */
  buckets: { label: string; lo: number; hi: number | null; tokenized: number; n: number }[];
}

const BUCKETS: { label: string; lo: number; hi: number | null }[] = [
  { label: '< 6 months', lo: 0, hi: 180 },
  { label: '6-18 months', lo: 180, hi: 540 },
  { label: '18-36 months', lo: 540, hi: 1095 },
  { label: '3 years +', lo: 1095, hi: null },
];

export function fitOdds(protocols: SnapshotProtocol[], asOf: string): OddsModel {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const withAge: { age: number; hasToken: boolean }[] = [];
  for (const p of protocols) {
    if (p.listed_at === null) continue;
    const t = Date.parse(`${p.listed_at}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(asOfMs)) continue;
    withAge.push({ age: Math.max(0, Math.floor((asOfMs - t) / 86_400_000)), hasToken: p.gecko_id !== null || p.symbol !== null });
  }

  const buckets = BUCKETS.map((b) => {
    const rows = withAge.filter((r) => r.age >= b.lo && (b.hi === null || r.age < b.hi));
    return { ...b, n: rows.length, tokenized: rows.filter((r) => r.hasToken).length };
  });

  // Laplace smoothing: a bucket with few records must not claim certainty.
  const shares = buckets.map((b) => (b.tokenized + 1) / (b.n + 2));

  // Logistic fit of token presence on ln(age+1), by Newton steps on the log-likelihood.
  let b0 = -3;
  let b1 = 0.5;
  if (withAge.length >= 20) {
    for (let step = 0; step < 25; step++) {
      let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
      for (const r of withAge) {
        const x = Math.log(r.age + 1);
        const y = r.hasToken ? 1 : 0;
        const z = b0 + b1 * x;
        const p = 1 / (1 + Math.exp(-z));
        const w = Math.max(1e-9, p * (1 - p));
        g0 += y - p;
        g1 += (y - p) * x;
        h00 -= w;
        h01 -= w * x;
        h11 -= w * x * x;
      }
      const det = h00 * h11 - h01 * h01;
      if (Math.abs(det) < 1e-12) break;
      const d0 = (-g0 * h11 + g1 * h01) / det;
      const d1 = (-g1 * h00 + g0 * h01) / det;
      b0 += d0;
      b1 += d1;
      if (Math.abs(d0) + Math.abs(d1) < 1e-8) break;
    }
  }

  const logistic = (age: number): number => 1 / (1 + Math.exp(-(b0 + b1 * Math.log(Math.max(0, age) + 1))));

  return {
    edges: BUCKETS.map((b) => b.lo),
    shares,
    b0: Math.round(b0 * 1e4) / 1e4,
    b1: Math.round(b1 * 1e4) / 1e4,
    n: withAge.length,
    at: (age: number | null) => {
      if (age === null) return logistic(365);
      return Math.min(0.98, Math.max(0.01, logistic(age)));
    },
    buckets,
  };
}

/** A protocol's peers in its own category, and where it sits among them by TVL. */
export interface CategoryContext {
  category: string | null;
  n: number;
  median_ratio: number | null;
  tvl_percentile: number | null;
}

export function categoryContext(p: SnapshotProtocol, peers: Peer[]): CategoryContext {
  if (p.category === null) return { category: null, n: 0, median_ratio: null, tvl_percentile: null };
  const same = peers.filter((q) => q.category === p.category);
  if (same.length === 0) return { category: p.category, n: 0, median_ratio: null, tvl_percentile: null };
  const ratios = same.map((q) => q.ratio).sort((a, b) => a - b);
  const below = same.filter((q) => q.tvl <= p.tvl_usd).length;
  return {
    category: p.category,
    n: same.length,
    median_ratio: ratios[Math.floor(ratios.length / 2)] ?? null,
    tvl_percentile: same.length > 0 ? below / same.length : null,
  };
}

/** Token-bearing peers in the same TVL band, used when a category has none to compare against. */
export interface SizeContext {
  label: string;
  n: number;
  median_ratio: number | null;
}

const SIZE_BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'under $20M TVL', lo: 0, hi: 20e6 },
  { label: '$20M to $100M TVL', lo: 20e6, hi: 100e6 },
  { label: '$100M to $500M TVL', lo: 100e6, hi: 500e6 },
  { label: '$500M to $2B TVL', lo: 500e6, hi: 2e9 },
  { label: 'over $2B TVL', lo: 2e9, hi: Number.POSITIVE_INFINITY },
];

export function sizeContext(tvl: number, peers: Peer[]): SizeContext {
  const band = SIZE_BANDS.find((b) => tvl >= b.lo && tvl < b.hi) ?? SIZE_BANDS[SIZE_BANDS.length - 1]!;
  const same = peers.filter((p) => p.tvl >= band.lo && p.tvl < band.hi);
  if (same.length === 0) return { label: band.label, n: 0, median_ratio: null };
  const ratios = same.map((p) => p.ratio).sort((a, b) => a - b);
  return { label: band.label, n: same.length, median_ratio: median(ratios) };
}

/**
 * Whether a category multiplier improves the order. Measured out-of-sample by the entry itself
 * (two folds, split by slug) and reported on the page: a term that does not beat the size-only
 * fit is not used.
 */
export interface CategoryTest {
  folds: { fit_on: number; tested_on: number; size_only_rho: number; with_category_rho: number }[];
  verdict: 'used' | 'rejected';
  mean_delta: number;
}

function rankOf(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

export function spearman(a: number[], b: number[]): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const n = a.length;
  if (n === 0) return 0;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i]! - ma;
    const y = rb[i]! - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Test the category term on held-out halves; it is only kept when it beats size alone. */
export function testCategory(peers: Peer[]): CategoryTest {
  const srt = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const halves = [srt.filter((_, i) => i % 2 === 0), srt.filter((_, i) => i % 2 === 1)];
  const folds: CategoryTest['folds'] = [];

  for (const [train, test] of [[halves[0]!, halves[1]!], [halves[1]!, halves[0]!]]) {
    if (train.length < 12 || test.length < 6) continue;
    const curve = fitCurve(train);
    // category offsets: median residual per category, shrunk toward zero by n/(n+4)
    const byCat = new Map<string, number[]>();
    for (const p of train) {
      const r = Math.log(p.ratio) - (curve.a0 + curve.a1 * Math.log10(p.tvl));
      const k = p.category ?? '(none)';
      const list = byCat.get(k) ?? [];
      list.push(r);
      byCat.set(k, list);
    }
    const offset = new Map<string, number>();
    for (const [k, v] of byCat) {
      offset.set(k, v.length >= 3 ? median(v) * (v.length / (v.length + 4)) : 0);
    }
    const sizeOnly = test.map((p) => curveValue(p.tvl, curve));
    const withCat = test.map((p) => curveValue(p.tvl, curve) * Math.exp(offset.get(p.category ?? '(none)') ?? 0));
    const actual = test.map((p) => p.mcap);
    folds.push({
      fit_on: train.length,
      tested_on: test.length,
      size_only_rho: Math.round(spearman(sizeOnly, actual) * 1000) / 1000,
      with_category_rho: Math.round(spearman(withCat, actual) * 1000) / 1000,
    });
  }

  const meanDelta = folds.length === 0 ? 0 : folds.reduce((s, f) => s + (f.with_category_rho - f.size_only_rho), 0) / folds.length;
  return { folds, verdict: meanDelta > 0.01 ? 'used' : 'rejected', mean_delta: Math.round(meanDelta * 1000) / 1000 };
}

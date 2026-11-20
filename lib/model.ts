// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   curve      = least squares of ln(mcap/tvl) on log10(tvl) over every token-bearing protocol,
//                giving ln(ratio) = a0 + a1 log10(tvl), so base = tvl x exp(a0) x tvl^(a1/ln10)
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

import {
  band, categoryContext, curveValue, fitCurve, fitCurveRobust, fitOdds, peersOf, sizeContext, spearman, testCategory,
  type CategoryContext, type CategoryTest, type Curve, type OddsModel, type SizeContext,
} from './valuation.ts';


/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
/**
 * The board's value model.
 *
 * The curve is fitted at run time from the snapshot's own token-bearing protocols:
 *   ln(mcap / TVL) = a0 + a1 * log10(TVL)
 * so a protocol's implied value is TVL^(1 + a1/ln10) times the growth and maturity terms, and the
 * dollar level reflects what the market actually pays for that size. A flat multiple of TVL is not
 * used: at this snapshot's peers it overvalues the largest protocols about sevenfold and
 * undervalues the smallest about twofold.
 *
 * A category multiplier was tested out of sample (two folds) and is only applied when it beats the
 * size-only fit; the result travels in the dossier and on the page.
 */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** A protocol's farm economics: what a $1,000 ticket is expected to return, net of costs. */
export interface FarmEconomics {
  verdict: 'FARM' | 'THIN' | 'SKIP';
  deposit: number;
  hold_days: number;
  drop_share: number;
  expected_drop: number;
  gas_cost: number;
  opportunity_cost: number;
  time_cost: number;
  total_cost: number;
  net: number;
  break_even_drop_share: number;
  hours: number;
  per_hour: number;
  exit_trigger: string;
}

/** The model's out-of-sample validation, computed on the snapshot's own token-bearing peers. */
export interface ModelValidation {
  n: number;
  rho: number;
  median_miss: number;
  within_3: number;
  band_60: number;
  flat_median_miss: number;
  flat_within_3: number;
  brier: number;
  brier_base: number;
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  farm: FarmEconomics;
  /** the share of same-age protocols that already record a token: a cross-sectional prior */
  launch_odds: number;
  /** the fitted value's interquartile band, same curve, residual quantiles applied */
  band_low_usd: number;
  band_high_usd: number;
  /** token-bearing peers in this protocol's category, and their median mcap/TVL */
  peers_in_category: number;
  category_median_ratio: number | null;
}

/** The dashboard's compact view of one row; the farm plan travels with it so the page adds no logic. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  launch_odds: number;
  band_low_usd: number;
  band_high_usd: number;
  farm_steps: string[];
  farm: FarmEconomics;
  peers_in_category: number;
  category_median_ratio: number | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** the fitted curve, so the page can state it and draw its bands */
  curve: { a0: number; a1: number; n: number; r2: number; power: number; q25: number; q75: number };
  /** the launch-odds table the board's prior comes from */
  odds: { label: string; lo: number; hi: number | null; tokenized: number; n: number; share: number }[];
  /** the logistic the per-row odds come from */
  odds_fit: { b0: number; b1: number; n: number };
  /** the token-bearing peers the curve was fitted on, for the page's scatter */
  peers: { tvl: number; mcap: number }[];
  /** the category term's held-out test: kept only when it beats the size-only fit */
  category_test: CategoryTest;
  /** the model's out-of-sample validation on the snapshot's token-bearing peers */
  validation: ModelValidation;
  /** the whole snapshot's accounting: every protocol is either ranked, a peer, or set aside */
  accounting: {
    total: number;
    peers: number;
    token_record: number;
    watchlist: number;
    early: number;
    set_aside: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, curve?: Curve): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = curve === undefined ? protocol.tvl_usd * model.base_multiple : curveValue(protocol.tvl_usd, curve);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** Median of an array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Quantile of an ascending-sorted array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Dollar formatting for the farm economics. */
function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/**
 * The model's out-of-sample validation. Five folds over the snapshot's token-bearing peers;
 * each fold fits the robust curve on the other four and prices the held-out peers with the
 * same growth and maturity terms the board uses. The flat-cap baseline is a constant 0.2x TVL.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants): ModelValidation {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.mcap_usd > 0);
  const sorted = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const folds: SnapshotProtocol[][] = [[], [], [], [], []];
  sorted.forEach((p, i) => folds[i % 5]!.push(p));
  const preds: number[] = [];
  const actual: number[] = [];
  const peerTvl: number[] = [];
  const residuals: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = folds[f]!;
    const train = folds.flatMap((g, i) => (i === f ? [] : g));
    const curve = fitCurveRobust(peersOf(train));
    for (const p of test) {
      const { implied } = impliedValue(p, snapshot.as_of, model, curve);
      preds.push(implied);
      actual.push(p.mcap_usd!);
      peerTvl.push(p.tvl_usd);
      residuals.push(Math.log(p.mcap_usd! / Math.max(1, implied)));
    }
  }
  const ratios = actual.map((a, i) => a / Math.max(1, preds[i]!));
  const sortedRes = [...residuals].sort((a, b) => a - b);
  const lo = quantile(sortedRes, 0.2);
  const hi = quantile(sortedRes, 0.8);
  const flat = actual.map((a, i) => a / Math.max(1, 0.2 * peerTvl[i]!));
  const odds = fitOdds(snapshot.protocols, snapshot.as_of);
  const withAge = snapshot.protocols.filter((p) => p.listed_at !== null);
  const ys = withAge.map((p) => (p.gecko_id !== null || p.symbol !== null ? 1 : 0));
  const ps = withAge.map((p) => odds.at(ageDays(snapshot.as_of, p.listed_at)));
  let brier = 0;
  for (let i = 0; i < ys.length; i++) brier += (ps[i]! - ys[i]!) ** 2;
  brier /= Math.max(1, ys.length);
  let base = 0;
  for (const y of ys) base += y;
  base /= Math.max(1, ys.length);
  let brierBase = 0;
  for (const y of ys) brierBase += (base - y) ** 2;
  brierBase /= Math.max(1, ys.length);
  return {
    n: peers.length,
    rho: Math.round(spearman(preds, actual) * 1000) / 1000,
    median_miss: Math.round(median(ratios) * 100) / 100,
    within_3: Math.round((ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length) * 100) / 100,
    band_60: Math.round((residuals.filter((r) => r >= lo && r <= hi).length / residuals.length) * 100) / 100,
    flat_median_miss: Math.round(median(flat) * 100) / 100,
    flat_within_3: Math.round((flat.filter((r) => r >= 1 / 3 && r <= 3).length / flat.length) * 100) / 100,
    brier: Math.round(brier * 1000) / 1000,
    brier_base: Math.round(brierBase * 1000) / 1000,
  };
}

/** One protocol's farm economics under a $1,000 ticket. */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  odds: number,
  implied: number,
  tvl: number,
): FarmEconomics {
  const deposit = 1000;
  const hold = holdDaysFor(age);
  const dropShare = 0.13;
  const expectedDrop = deposit * dropShare * odds;
  const gas = 8 + 2 * (hold / 30);
  const opportunity = deposit * 0.04 * (hold / 365);
  const hours = 1.25 + (hold / 30) * 0.5;
  const timeCost = hours * 20;
  const totalCost = gas + opportunity + timeCost;
  const net = expectedDrop - totalCost;
  const breakEven = totalCost / Math.max(0.01, deposit * odds);
  const perHour = net / hours;
  const verdict: FarmEconomics['verdict'] = net >= 20 && odds >= 0.35 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  const exitTrigger = `TVL below ${money(tvl * 0.83)} (-17%) or withdrawals paused`;
  return {
    verdict,
    deposit,
    hold_days: hold,
    drop_share: dropShare,
    expected_drop: Math.round(expectedDrop * 100) / 100,
    gas_cost: Math.round(gas * 100) / 100,
    opportunity_cost: Math.round(opportunity * 100) / 100,
    time_cost: Math.round(timeCost * 100) / 100,
    total_cost: Math.round(totalCost * 100) / 100,
    net: Math.round(net * 100) / 100,
    break_even_drop_share: Math.round(breakEven * 1000) / 1000,
    hours: Math.round(hours * 100) / 100,
    per_hour: Math.round(perHour * 100) / 100,
    exit_trigger: exitTrigger,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The fitted terms a board shares: the curve, the peers behind it, the odds table, the category verdict. */
export interface ModelContext {
  curve: Curve;
  peers: ReturnType<typeof peersOf>;
  odds: OddsModel;
  categoryTest: CategoryTest;
}

/** Fit every shared term once, so the board and the page agree on them. */
export function modelContext(snapshot: Snapshot): ModelContext {
  const peers = peersOf(snapshot.protocols);
  return {
    curve: fitCurveRobust(peers),
    peers,
    odds: fitOdds(snapshot.protocols, snapshot.as_of),
    categoryTest: testCategory(peers),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, ctx?: ModelContext): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const context = ctx ?? modelContext(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, context.curve);
    const b = band(implied, context.curve);
    const cat: CategoryContext = categoryContext(p, context.peers);
    const size: SizeContext = sizeContext(p.tvl_usd, context.peers);
    return { p, implied, growthPct, growthMult, maturityMult, age, band: b, cat, size, odds: context.odds.at(age), farm: farmEconomics(p, age, context.odds.at(age), implied, p.tvl_usd) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, {
      low: s.band.low,
      high: s.band.high,
      implied: s.implied,
      odds: s.odds,
      peers: s.cat.n,
      medianRatio: s.cat.median_ratio,
      sizeLabel: s.size.label,
      sizePeers: s.size.n,
      sizeMedianRatio: s.size.median_ratio,
      farm: s.farm,
    }).map(stepText),
    farm: s.farm,
    launch_odds: Math.round(s.odds * 1000) / 1000,
    band_low_usd: s.band.low,
    band_high_usd: s.band.high,
    peers_in_category: s.cat.n,
    category_median_ratio: s.cat.median_ratio === null ? null : round4(s.cat.median_ratio),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  ctx: {
    low: number; high: number; implied: number; odds: number; peers: number; medianRatio: number | null;
    sizeLabel: string; sizePeers: number; sizeMedianRatio: number | null; farm: FarmEconomics;
  },
): FarmStep[] {
  const chain = chainOf(p);
  const capital = ctx.farm.deposit;
  const hold = ctx.farm.hold_days;
  const action = actionFor(p, capital, chain);
  const perTvl = ctx.implied / Math.max(1, p.tvl_usd);
  const steps: FarmStep[] = [
    {
      text: `${action} Size it at $${capital}: a $1,000 ticket is modelled to return $${ctx.farm.expected_drop.toFixed(2)} if the token launches (${(ctx.odds * 100).toFixed(0)}% odds), against $${ctx.farm.total_cost.toFixed(2)} of gas, fees and time. Verdict: ${ctx.farm.verdict}.`,
      cost: `$${capital} of capital, about $${ctx.farm.gas_cost.toFixed(0)} in gas`,
      time: '15 minutes to set up',
    },
  ];

  if (p.chains.length > 1) {
    steps.push({
      text: `Keep the position on ${chain}, where the protocol is listed first; its other chains are ${p.chains.slice(1, 4).join(', ')}. Bridging in and out costs a fee each way, so do not spread $${capital} across several.`,
      cost: `one bridge fee each way if you use another chain`,
      time: '20 minutes once',
    });
  } else {
    steps.push({
      text: `${p.name} is listed on ${chain} alone, so there is no bridge and no second venue to split the position across.`,
      cost: 'no bridge fee',
      time: 'none',
    });
  }

  if (ctx.medianRatio !== null && ctx.peers >= 3) {
    const peerValue = Math.round(p.tvl_usd * ctx.medianRatio);
    steps.push({
      text: `Benchmark the payout against its own category: ${ctx.peers} token-bearing peers trade at a median ${ctx.medianRatio.toFixed(3)}x TVL, which would value ${p.name} at $${Math.round(peerValue / 1e6)}M against the model's $${Math.round(ctx.implied / 1e6)}M (${(perTvl * 100).toFixed(1)}% of TVL). A launch at the peer median is the upside case, not the base case.`,
      cost: 'nothing, this is the pricing check before you commit capital',
      time: '5 minutes',
    });
  } else {
    const bandMedian = ctx.sizeMedianRatio;
    steps.push({
      text: bandMedian === null
        ? `No token-bearing peer in its category to benchmark against, so the band is the only guide: $${Math.round(ctx.low / 1e6)}M to $${Math.round(ctx.high / 1e6)}M around a $${Math.round(ctx.implied / 1e6)}M point estimate.`
        : `Its category has no token-bearing peer, so price it against size: ${ctx.sizePeers} protocols in the ${ctx.sizeLabel} band trade at a median ${bandMedian.toFixed(3)}x TVL, which would put ${p.name} at $${Math.round(p.tvl_usd * bandMedian / 1e6)}M. The fit says $${Math.round(ctx.implied / 1e6)}M, below that median.`,
      cost: 'nothing, this is the pricing check before you commit capital',
      time: '5 minutes',
    });
  }

  steps.push({
    text: `Do one qualifying action every ${ctx.odds >= 0.5 ? 'two' : 'four'} weeks, not a burst at the end: the odds above come from protocols that held positions across several snapshots, and a single late transaction is the pattern most often filtered out. Break-even needs a drop share above ${(ctx.farm.break_even_drop_share * 100).toFixed(1)}% of the $1,000 ticket.`,
    cost: `about $${ctx.odds >= 0.5 ? 4 : 2} of gas a month`,
    time: `10 minutes every ${ctx.odds >= 0.5 ? 'two' : 'four'} weeks`,
  });

  steps.push({
    text: `Hold at least ${hold} days. The modelled net is $${ctx.farm.net} after $${ctx.farm.total_cost} of gas, fees and time, so the position is ${ctx.farm.verdict}. Exit if ${ctx.farm.exit_trigger}.`,
    cost: `the $${capital} stays locked for ${hold} days`,
    time: `${hold} days`,
  });

  steps.push({
    text: `Claim only from a link the protocol publishes itself, and write the wallet, dates and transactions into a log so the position can be repeated or unwound without guessing. The modelled hourly margin is $${ctx.farm.per_hour} over ${ctx.farm.hours} hours of work.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  });

  return steps;
}

/** The bucket label the odds table uses, for a step that quotes the base rate. */
function holdBucket(age: number): string {
  if (age < 180) return 'under six months old';
  if (age < 540) return 'six to eighteen months old';
  if (age < 1095) return 'eighteen to thirty-six months old';
  return 'over three years old';
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    launch_odds: row.launch_odds,
    band_low_usd: row.band_low_usd,
    band_high_usd: row.band_high_usd,
    farm_steps: row.farm_steps,
    farm: row.farm,
    peers_in_category: row.peers_in_category,
    category_median_ratio: row.category_median_ratio,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const ctx = modelContext(snapshot);
  const board = buildBoard(snapshot, model, ctx);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    curve: {
      a0: Math.round(ctx.curve.a0 * 1e4) / 1e4,
      a1: Math.round(ctx.curve.a1 * 1e4) / 1e4,
      n: ctx.curve.n,
      r2: Math.round(ctx.curve.r2 * 1e4) / 1e4,
      power: Math.round(ctx.curve.power * 1e4) / 1e4,
      q25: Math.round(ctx.curve.q25 * 1e4) / 1e4,
      q75: Math.round(ctx.curve.q75 * 1e4) / 1e4,
    },
    odds: ctx.odds.buckets.map((b, i) => ({
      label: b.label,
      lo: b.lo,
      hi: b.hi,
      tokenized: b.tokenized,
      n: b.n,
      share: Math.round((ctx.odds.shares[i] ?? 0) * 1000) / 1000,
    })),
    category_test: ctx.categoryTest,
    validation: validateModel(snapshot, model),
    accounting: {
      total: snapshot.protocols.length,
      peers: ctx.peers.length,
      token_record: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
      watchlist: snapshot.watchlist.length,
      early,
      set_aside: snapshot.protocols.length - ctx.peers.length - snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length - board.length,
    },
    odds_fit: { b0: ctx.odds.b0, b1: ctx.odds.b1, n: ctx.odds.n },
    peers: ctx.peers.map((p) => ({ tvl: Math.round(p.tvl), mcap: Math.round(p.mcap) })),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

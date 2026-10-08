/**
 * SMOOTH APPROXIMATIONS FOR PERCENTILES AND CHIPS
 * -----------------------------------------------
 * A Beta distribution over the success rate (0-1) fitted to what a
 * participant gave, so all three formats can be summarised and drawn the
 * same way. The fit is a convenience: the raw answers (p10/p50/p90, the ten
 * chip counts) are always kept and remain the primary data.
 *
 * Both fits are least squares on the cumulative distribution (CDF): choose
 * alpha and beta so that the Beta CDF passes as close as possible to the
 * stated cumulative probabilities --
 *   Percentiles: F(p10) = 0.1, F(p50) = 0.5, F(p90) = 0.9
 *   Chips:       F(b) = share of chips below b, at the 9 inner bin boundaries
 *                (10, 20, ..., 90 out of 100), plus each bin's midpoint with
 *                its chips taken as spread evenly across the bin (so a pile in
 *                an end bin, 0-9 or 90-100, still has a centre to fit)
 * Fitting CDF points rather than histogram heights is the usual practice and
 * is far less sensitive to how the bins are drawn.
 *
 * Numerics: the search runs over (log alpha, log beta), so the parameters
 * stay positive; both are bounded to [LOG_MIN, LOG_MAX]; it is a Nelder-Mead
 * simplex started from several points (a moment-matched guess and spreads
 * around it), keeping the best. Points exactly at 0 or 100 are moved half a
 * success inside the scale, where a Beta CDF can reach the stated
 * probability. Failures return { valid: false, reason } rather than throwing.
 */
import { regularizedIncompleteBeta, betaQuantile } from './stats.js';

const LOG_MIN = Math.log(0.01);
const LOG_MAX = Math.log(5000);
const EDGE = 0.005; // half a success out of 100
const clampRate = (x) => Math.min(1 - EDGE, Math.max(EDGE, x));
const clampLog = (v) => Math.min(LOG_MAX, Math.max(LOG_MIN, v));

/**
 * Least-squares Beta fit to CDF targets [{ x: rate in 0-1, p: cumulative probability }].
 * Returns { valid, alpha, beta, rmse, p10, p50, p90 } (percentiles as rates 0-1).
 */
export function fitBetaToCdf(points, { start } = {}) {
  if (!Array.isArray(points) || points.length < 2 ||
      points.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.p))) {
    return { valid: false, reason: 'invalid_input' };
  }
  const targets = points.map((pt) => ({ x: clampRate(pt.x), p: pt.p }));
  const loss = ([u, v]) => {
    const a = Math.exp(clampLog(u)), b = Math.exp(clampLog(v));
    let sum = 0;
    for (const { x, p } of targets) {
      const d = regularizedIncompleteBeta(x, a, b) - p;
      sum += d * d;
    }
    return Number.isFinite(sum) ? sum / targets.length : Infinity;
  };

  const guess = start || momentGuess(targets);
  const starts = [
    guess,
    [guess[0] - 1, guess[1] - 1], // a third as concentrated
    [guess[0] + 1, guess[1] + 1], // three times as concentrated
    [0, 0], // uniform
  ].map(([u, v]) => [clampLog(u), clampLog(v)]);

  let best = null;
  for (const s of starts) {
    const result = nelderMead(loss, s);
    if (!best || result.value < best.value) best = result;
  }
  if (!best || !Number.isFinite(best.value)) return { valid: false, reason: 'no_fit' };
  const alpha = Math.exp(clampLog(best.point[0])), beta = Math.exp(clampLog(best.point[1]));
  const [p10, p50, p90] = [0.1, 0.5, 0.9].map((q) => betaQuantile(q, alpha, beta));
  if (![alpha, beta, p10, p50, p90].every(Number.isFinite)) return { valid: false, reason: 'no_fit' };
  return { valid: true, alpha, beta, rmse: Math.sqrt(best.value), p10, p50, p90 };
}

/** The 10th / 50th / 90th percentiles given as successes out of 100. */
export function fitBetaToPercentiles(p10, p50, p90) {
  const v = [p10, p50, p90].map((x) => (x === '' || x === null || x === undefined ? NaN : Number(x)));
  if (!v.every(Number.isFinite) || v.some((x) => x < 0 || x > 100)) return { valid: false, reason: 'incomplete' };
  if (!(v[0] <= v[1] && v[1] <= v[2])) return { valid: false, reason: 'out_of_order' };
  return { ...fitBetaToCdf([{ x: v[0] / 100, p: 0.1 }, { x: v[1] / 100, p: 0.5 }, { x: v[2] / 100, p: 0.9 }]),
    method: 'percentiles_cdf_least_squares_v1' };
}

/**
 * Chip counts per equal-width bin, lowest first (bin i spans 10i to 10i+10
 * successes out of 100 when read as a continuous quantity).
 */
export function fitBetaToChips(counts, total = 20) {
  if (!Array.isArray(counts) || counts.length < 2) return { valid: false, reason: 'incomplete' };
  const c = counts.map((x) => Math.max(0, Number(x) || 0));
  const sum = c.reduce((a, b) => a + b, 0);
  if (sum !== total) return { valid: false, reason: 'incomplete' };
  const width = 1 / c.length;
  const points = [];
  let cum = 0;
  c.forEach((n, i) => {
    points.push({ x: (i + 0.5) * width, p: (cum + n / 2) / sum });
    cum += n;
    if (i < c.length - 1) points.push({ x: (i + 1) * width, p: cum / sum });
  });
  // Start from the histogram's own mean and spread.
  const mids = c.map((_, i) => (i + 0.5) * width);
  const mean = mids.reduce((a, m, i) => a + m * c[i], 0) / sum;
  const variance = mids.reduce((a, m, i) => a + (m - mean) ** 2 * c[i], 0) / sum + width ** 2 / 12;
  return { ...fitBetaToCdf(points, { start: logParams(mean, Math.sqrt(variance)) }), method: 'chips_cdf_least_squares_v1' };
}

// Beta parameters (in log space) with roughly this mean and standard deviation.
function logParams(mean, sd) {
  const m = clampRate(mean);
  const s = Math.max(0.005, Math.min(sd, Math.sqrt(m * (1 - m)) * 0.99));
  const nu = Math.max(0.05, (m * (1 - m)) / (s * s) - 1);
  return [Math.log(m * nu), Math.log((1 - m) * nu)];
}
function momentGuess(targets) {
  // The point nearest p = 0.5 as the centre; the spread from the outermost points.
  const centre = targets.reduce((best, t) => (Math.abs(t.p - 0.5) < Math.abs(best.p - 0.5) ? t : best));
  const lo = targets[0], hi = targets[targets.length - 1];
  const zSpan = Math.max(0.5, normalZ(hi.p) - normalZ(lo.p));
  return logParams(centre.x, Math.max(0.005, (hi.x - lo.x) / zSpan));
}
// Rough inverse normal CDF, only for starting values.
function normalZ(p) {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.sign(q - 0.5) * Math.sqrt(-2 * Math.log(Math.min(q, 1 - q)) * 0.9);
}

/** Minimal Nelder-Mead for two parameters. */
function nelderMead(f, start, { step = 0.5, maxIter = 400, tol = 1e-12 } = {}) {
  let simplex = [start, [start[0] + step, start[1]], [start[0], start[1] + step]].map((p) => ({ point: p, value: f(p) }));
  const add = (a, b, k) => [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])];
  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.value - b.value);
    const [bestP, mid, worst] = simplex;
    if (Math.abs(worst.value - bestP.value) < tol && iter > 20) break;
    const centroid = [(bestP.point[0] + mid.point[0]) / 2, (bestP.point[1] + mid.point[1]) / 2];
    const reflected = add(centroid, worst.point, -1);
    const fr = f(reflected);
    if (fr < bestP.value) {
      const expanded = add(centroid, worst.point, -2);
      const fe = f(expanded);
      simplex[2] = fe < fr ? { point: expanded, value: fe } : { point: reflected, value: fr };
    } else if (fr < mid.value) {
      simplex[2] = { point: reflected, value: fr };
    } else {
      const contracted = add(centroid, worst.point, 0.5);
      const fc = f(contracted);
      if (fc < worst.value) simplex[2] = { point: contracted, value: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : { point: add(bestP.point, s.point, 0.5), value: f(add(bestP.point, s.point, 0.5)) }));
    }
  }
  simplex.sort((a, b) => a.value - b.value);
  return simplex[0];
}

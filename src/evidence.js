/**
 * HYPOTHETICAL EVIDENCE FOR THE UPDATE FORMAT
 * -------------------------------------------
 * The imagined evaluation results shown after an initial estimate. This file
 * is the one place that decides them: change EVIDENCE_RULE (or replace
 * generateEvidence) to change the rule; nothing in the pages or app.js needs
 * to know how the numbers were chosen.
 *
 * Current rule ("hfs_tail_matched_v2", a Hypothetical Future Samples design):
 * the initial estimate is the participant's EXPECTED success rate,
 * p0 = estimate / scale. Two results are shown, each out of the question's
 * own n trials, one on each side of p0:
 *
 *   "up"    the count x with x/n > p0 whose upper tail P(X >= x) is closest
 *           to TARGET_TAIL
 *   "down"  the count x with x/n < p0 whose lower tail P(X <= x) is closest
 *           to TARGET_TAIL
 *
 * with X ~ Binomial(n, p0) and inclusive tails. So the two are about equally
 * surprising if the estimate were right -- not equally far from it: near 0 or
 * 100 the side with room to move lies further away in percentage points, and
 * at n = 20 the same surprise needs a bigger move than at n = 100. Both are
 * deliberate.
 *
 * TARGET_TAIL = 0.075 is a design choice for this pilot (moderately surprising
 * but plausible results), not a value taken from the literature.
 *
 * With few trials the counts are coarse, and near an extreme estimate one side
 * may have no count anywhere near the target (at p0 = 0.02 with n = 20, even
 * x = 0 has a lower tail of about 0.67). The closest available count is used
 * anyway -- never a fractional count, a different n, a switched direction or
 * a repeated result -- and its actual tail and its distance from the target
 * are returned for the record. No threshold changes what is shown.
 *
 * At an estimate of exactly 0 or the top of the scale the binomial is
 * degenerate and one side does not exist. The main questions ask a follow-up
 * instead (pages/blocks.js); the training uses `boundaryBands` -- results
 * spread out on the only side there is -- so the format still works.
 */
import { binomialPmf, shuffle } from './stats.js';
import { TARGET_TAIL, ADAPTIVE_N, ADAPTIVE_FEASIBLE_P_ZERO, ADAPTIVE_ONE_SIDED_TARGETS } from './design.js';

export const EVIDENCE_RULE = {
  name: 'hfs_tail_matched_v2',
  targetTail: TARGET_TAIL,
  // Percent-of-n bands, used only from an estimate of exactly 0 or the top.
  boundaryBands: [[10, 25], [35, 60]],
};

/**
 * @param estimate  the initial expected estimate, out of `scale` (0..scale)
 * @param opts.n      number of hypothetical trials (e.g. 20 or 100)
 * @param opts.scale  what the estimate is out of (100, or 10,000 on the fine scale)
 * @returns [{ direction, x, n, rate, target_tail, tail, tail_mismatch }], up and
 *          down in random order; [] if the estimate is invalid
 */
export function generateEvidence(estimate, { n, scale = 100, rng = Math.random, rule = EVIDENCE_RULE } = {}) {
  // Blank is not 0: Number('') would quietly turn a missing answer into one.
  const s = estimate === '' || estimate === null ? NaN : Number(estimate);
  if (!Number.isFinite(s) || s < 0 || s > scale || !Number.isInteger(n) || n < 1) return [];
  const target = rule.targetTail;
  const record = (direction, x, tail) => ({ direction, x, n, rate: x / n, target_tail: target, tail,
    tail_mismatch: tail === null ? null : Math.abs(tail - target) });

  if (s === 0 || s === scale) {
    const between = ([lo, hi]) => lo + rng() * (hi - lo);
    const direction = s === 0 ? 'up' : 'down';
    return shuffle(rule.boundaryBands.map((band) => {
      const x = Math.round((between(band) / 100) * n);
      return record(direction, s === 0 ? x : n - x, null);
    }), rng);
  }

  const p0 = s / scale;
  const pmf = binomialPmf(n, p0);
  const up = countForTail(pmf, n * p0, 'up', target);
  const down = countForTail(pmf, n * p0, 'down', target);
  return shuffle([record('up', up.x, up.tail), record('down', down.x, down.tail)], rng);
}

/**
 * ADAPTIVE BOUNDARY EVIDENCE (Update after a rounded 0/100 or 100/100)
 * The refined count is in the rare event's coordinate (successes after 0,
 * failures after 100), out of ADAPTIVE_N; so is the evidence. With
 * r = count / n and X ~ Binomial(n, r):
 *   two-sided  when P(X = 0) <= ADAPTIVE_FEASIBLE_P_ZERO: one result below r
 *              and one above, each at the tail closest to TARGET_TAIL (the
 *              same rule as the standard format)
 *   one-sided  otherwise: two distinct results above r, at the upper tails
 *              closest to ADAPTIVE_ONE_SIDED_TARGETS (0.075, then the stronger
 *              0.02); if both would land on the same count, the second moves
 *              to the next count up
 * Order is random. Each result records `mode` as well as the usual fields.
 */
export const ADAPTIVE_RULE = { name: 'adaptive_boundary_v1', n: ADAPTIVE_N,
  feasibleProbZero: ADAPTIVE_FEASIBLE_P_ZERO, twoSidedTarget: TARGET_TAIL, oneSidedTargets: ADAPTIVE_ONE_SIDED_TARGETS };

export function generateAdaptiveEvidence(count, { rng = Math.random, rule = ADAPTIVE_RULE } = {}) {
  const n = rule.n;
  const c = count === '' || count === null ? NaN : Number(count);
  if (!Number.isInteger(c) || c < 1 || c >= n) return [];
  const r = c / n;
  const pmf = binomialPmf(n, r);
  const probZero = pmf[0];
  const record = (mode, direction, x, tail, target) => ({ mode, direction, x, n, rate: x / n, target_tail: target,
    tail, tail_mismatch: Math.abs(tail - target), p_zero: probZero });
  if (probZero <= rule.feasibleProbZero) {
    const up = countForTail(pmf, c, 'up', rule.twoSidedTarget);
    const down = countForTail(pmf, c, 'down', rule.twoSidedTarget);
    return shuffle([record('two_sided', 'up', up.x, up.tail, rule.twoSidedTarget),
      record('two_sided', 'down', down.x, down.tail, rule.twoSidedTarget)], rng);
  }
  const [t1, t2] = rule.oneSidedTargets;
  const first = countForTail(pmf, c, 'up', t1);
  let second = countForTail(pmf, c, 'up', t2);
  if (second.x <= first.x) {
    // Distinct, and the second the stronger contradiction.
    const x = Math.min(n, first.x + 1);
    second = { x, tail: pmf.slice(x).reduce((a, b) => a + b, 0) };
  }
  return shuffle([record('one_sided', 'up', first.x, first.tail, t1),
    record('one_sided', 'up', second.x, second.tail, t2)], rng);
}

/**
 * The count x strictly on one side of the expected count whose one-sided
 * inclusive tail -- P(K >= x) going up, P(K <= x) going down -- is closest to
 * `target`. An exact tie keeps the less extreme x. Strictly-on-one-side counts
 * always exist for 0 < p0 < 1 (x = n going up, x = 0 going down).
 */
export function countForTail(pmf, expected, direction, target) {
  const n = pmf.length - 1;
  let best = null;
  let tail = 0;
  if (direction === 'up') {
    const first = Math.floor(expected) + 1;
    for (let k = n; k >= first; k -= 1) {
      tail += pmf[k];
      // Walking inwards, so prefer the later (less extreme) x on a tie.
      if (!best || Math.abs(tail - target) <= Math.abs(best.tail - target) + Number.EPSILON) best = { x: k, tail };
    }
    return best || { x: n, tail: pmf[n] };
  }
  const first = Math.ceil(expected) - 1;
  for (let k = 0; k <= first; k += 1) {
    tail += pmf[k];
    if (!best || Math.abs(tail - target) <= Math.abs(best.tail - target) + Number.EPSILON) best = { x: k, tail };
  }
  return best || { x: 0, tail: pmf[0] };
}

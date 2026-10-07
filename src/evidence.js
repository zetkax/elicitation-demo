/**
 * HYPOTHETICAL EVIDENCE FOR THE UPDATE FORMAT
 * -------------------------------------------
 * The imagined evaluation results shown after an initial estimate. This file
 * is the one place that decides them: change EVIDENCE_RULE (or replace
 * generateEvidence) to change the rule; nothing in the pages or app.js needs
 * to know how the numbers were chosen.
 *
 * Current rule ("tail_matched_v1"): every result is chosen by how surprising
 * it would be if the participant's estimate were exactly right -- its
 * binomial tail probability under Binomial(n, estimate) -- rather than by a
 * fixed distance. So with n = 20 and n = 100 the results are similarly
 * surprising, even though the same surprise is a bigger move in percentage
 * points at n = 20. Three kinds probe different things:
 *
 *   "extreme"  moderately surprising, AWAY from 50%
 *   "middle"   moderately surprising, TOWARDS 50%
 *   "jump"     very surprising, TOWARDS 50%
 *
 * Each target tail is drawn at random from its range, so the same estimate
 * does not always produce the same numbers, and the three are shuffled. With
 * few trials the counts are coarse, so the achieved tail is the closest one
 * available, not the target exactly; it is returned for the record.
 *
 * At an estimate of exactly 0 or 100% the binomial is degenerate. The main
 * questions ask a follow-up instead (pages/blocks.js); the training uses the
 * spread-out `boundaryBands` so the format still works.
 */
import { binomialPmf, shuffle } from './stats.js';

export const EVIDENCE_RULE = {
  name: 'tail_matched_v1',
  kinds: [
    { kind: 'extreme', towardsHalf: false, tail: [0.05, 0.2] },
    { kind: 'middle', towardsHalf: true, tail: [0.05, 0.2] },
    { kind: 'jump', towardsHalf: true, tail: [0.001, 0.01] },
  ],
  // With a single result (count 1), only this kind is used.
  single: 'middle',
  // Percent-of-n bands used only from an estimate of exactly 0 or 100.
  boundaryBands: [[10, 25], [35, 60], [70, 90]],
};

/**
 * @param estimate  the initial estimate, out of `scale` (0..scale)
 * @param opts.n      number of hypothetical trials (e.g. 20 or 100)
 * @param opts.scale  what the estimate is out of (100, or 10,000 on the fine scale)
 * @param opts.count  how many results (1 or 3)
 * @returns [{ x, kind, tail }] with x a count out of n; [] if the estimate is invalid
 */
export function generateEvidence(estimate, { n, scale = 100, count = 3, rng = Math.random, rule = EVIDENCE_RULE } = {}) {
  // Blank is not 0: Number('') would quietly turn a missing answer into one.
  const s = estimate === '' || estimate === null ? NaN : Number(estimate);
  if (!Number.isFinite(s) || s < 0 || s > scale || !Number.isInteger(n) || n < 1) return [];
  const between = ([lo, hi]) => lo + rng() * (hi - lo);

  if (s === 0 || s === scale) {
    const bands = rule.boundaryBands.map(([lo, hi]) => Math.round((between([lo, hi]) / 100) * n));
    return shuffle(bands.map((x) => ({ x: s === scale ? n - x : x, kind: 'boundary', tail: null })), rng).slice(0, count);
  }

  const mu = s / scale;
  const upIsTowardsHalf = mu < 0.5 || (mu === 0.5 && rng() < 0.5);
  const kinds = count === 1 ? rule.kinds.filter((k) => k.kind === rule.single) : rule.kinds.slice(0, count);
  const pmf = binomialPmf(n, mu);
  const results = kinds.map(({ kind, towardsHalf, tail }) => {
    const up = towardsHalf === upIsTowardsHalf;
    return { kind, ...countForTail(pmf, n * mu, up ? 'up' : 'down', between(tail)) };
  });
  return count === 1 ? results : shuffle(results, rng);
}

/**
 * The count x on one side of the expected count whose tail probability --
 * P(K >= x) going up, P(K <= x) going down -- is closest to `target`. An exact
 * tie keeps the less extreme x. Falls back to the extreme count when there is
 * nothing strictly on that side (e.g. an expected count above n - 1).
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

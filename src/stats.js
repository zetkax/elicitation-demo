/**
 * Pure elicitation maths. No DOM, no SurveyJS, no config -- so every consumer
 * (the survey, the tests, any future replay tool) computes identical numbers.
 */
import { formatCount } from "./format.js";

export const N = 100;
export const TARGET_TAIL = 0.1;
export const NUMERIC_EPSILON = 1e-12;

/**
 * HYPOTHETICAL SAMPLES
 * --------------------
 * The imagined evaluation results shown after an initial estimate s. They are
 * drawn at random, so the same estimate does not always produce the same
 * numbers, and three kinds are used so each update probes something different:
 *
 *   "extreme"  moderately surprising, AWAY from 50 (towards 0 if s < 50,
 *              towards 100 if s > 50)
 *   "middle"   moderately surprising, TOWARDS 50
 *   "jump"     a large move towards 50, and usually past it: |X - s| is a
 *              random 30-50 points
 *
 * "Moderately surprising" means a result whose binomial tail probability, if
 * the estimate were exactly right, is a random value in SURPRISE_RANGE.
 *
 * Returns [{ x, kind }]. With count 3 the order is shuffled, so the jump is not
 * always last and practice does not teach a pattern. With count 1 (practice 1)
 * only a "middle" result is returned. At s = 50 the "extreme" side is chosen
 * by coin. At s = 0 or 100 no Beta can be fitted anyway, so three spread-out
 * results are shown (kind "boundary") just so the format stays the same.
 *
 * `rng` is injectable so tests are reproducible; production uses Math.random.
 *
 * `n` is the number of imagined trials: 100 everywhere except the finer
 * 10,000 scale offered after an answer of 0 or 100 (see RARE_N). Point ranges
 * here are written for 100 and scaled with n, so "50" means half of n.
 */
export const SURPRISE_RANGE = [0.05, 0.2];
export const JUMP_RANGE = [30, 50];
export const RARE_N = 10000;

export function chooseHypotheticalSamples(s, { count = 3, rng = Math.random, n = N } = {}) {
  if (!Number.isInteger(s) || s < 0 || s > n) return [];
  const per100 = n / 100;
  const between = ([lo, hi]) => lo + rng() * (hi - lo);
  const intBetween = ([lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

  if (s === 0 || s === n) {
    // Three bands well apart; from n they are mirrored, so all move away from it.
    const bands = [[10, 25], [35, 60], [70, 90]].map(([lo, hi]) => intBetween([lo * per100, hi * per100]));
    return shuffle(bands.map(x => ({ x: s === n ? n - x : x, kind: "boundary" })), rng);
  }

  const half = n / 2;
  const towardsMiddle = s < half ? "up" : s > half ? "down" : rng() < 0.5 ? "up" : "down";
  const towardsExtreme = towardsMiddle === "up" ? "down" : "up";
  const middle = { x: xForTail(s, towardsMiddle, between(SURPRISE_RANGE), n), kind: "middle" };
  if (count === 1) return [middle];

  const sign = towardsMiddle === "up" ? 1 : -1;
  const jumpX = Math.min(n, Math.max(0, s + sign * intBetween(JUMP_RANGE.map(v => v * per100))));
  return shuffle([
    { x: xForTail(s, towardsExtreme, between(SURPRISE_RANGE), n), kind: "extreme" },
    middle,
    { x: jumpX, kind: "jump" },
  ], rng);
}

/** Fisher-Yates shuffle; returns a new array. `rng` is injectable for tests. */
export function shuffle(items, rng = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const numericAnswer = v => v !== null && v !== undefined && String(v).trim() !== "" && Number.isFinite(Number(v));

/** Equal-weight least squares on revised counts, holding the elicited mean fixed.
 * With n trials, predicted revision = s + w*(x-s), w=n/(nu+n).
 * Solving for w jointly is convex; limits keep the Beta proper and numerical
 * quantiles stable. Boundary solutions and residuals are internal diagnostics.
 * maxNu scales with n (10,000 at n=100), so the finer scale can still express
 * a belief that is confident relative to its own evidence.
 */
export function fitBetaUpdates(rawS, samples, minimum = 2, n = N) {
  // A boundary estimate is reported as such even before the updates are in:
  // at 0 or n no Beta exists, however the updates are answered.
  if (numericAnswer(rawS) && (Number(rawS) <= 0 || Number(rawS) >= n)) {
    return { valid: false, reason: "boundary_mean" };
  }
  if (!numericAnswer(rawS) || !Array.isArray(samples) || samples.length < minimum ||
      samples.some(r => !numericAnswer(r.x) || !numericAnswer(r.updated))) {
    return { valid: false, reason: "incomplete" };
  }
  const s = Number(rawS);
  if (samples.some(r => Number(r.x) < 0 || Number(r.x) > n || Number(r.updated) < 0 || Number(r.updated) > n)) {
    return { valid: false, reason: "outside_count_range" };
  }
  const denominator = samples.reduce((sum, r) => sum + (Number(r.x) - s) ** 2, 0);
  if (!denominator) return { valid: false, reason: "uninformative_evidence" };
  const rawWeight = samples.reduce((sum, r) => sum + (Number(r.x) - s) * (Number(r.updated) - s), 0) / denominator;
  const minNu = 0.01, maxNu = 100 * n;
  const weight = Math.max(n / (n + maxNu), Math.min(n / (n + minNu), rawWeight));
  const nu = n * (1 - weight) / weight;
  const residuals = samples.map(r => Number(r.updated) - (s + weight * (Number(r.x) - s)));
  return { valid: true, mu: s / n, nu, alpha: s / n * nu, beta: (1 - s / n) * nu,
    diagnostics: { method: "fixed_mean_count_least_squares_v1", n, sampleCount: samples.length,
      rawWeight, weight, minNu, maxNu, atBoundary: rawWeight !== weight, residuals,
      rmse: Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / samples.length),
      classifications: samples.map(r => classifyUpdate(s, Number(r.x), Number(r.updated))) } };
}
/**
 * X-SELECTION RULE
 * ----------------
 * For s in 1..99, let mu=s/100 and K~Binomial(100, mu).
 * - mu < 0.5: choose X>s with P(K>=X) closest to 0.10.
 * - mu > 0.5: choose X<s with P(K<=X) closest to 0.10.
 * - mu = 0.5: the binomial is symmetric, so neither direction is implied by
 *   the estimate. Toss a fair coin instead of always revising downwards.
 * Iterating outwards from s and updating only on a strict improvement makes
 * an exact tie prefer the less-extreme X. The 0 and 100 cases return null.
 *
 * `forcedDirection` ("up" | "down") is for deterministic tests; production
 * callers omit it. The result is computed once per answer and persisted as
 * generated_x, so the coin toss stays stable for a given estimate.
 */
export function chooseHypotheticalX(rawS, forcedDirection) {
  const s = Number(rawS);

  if (!Number.isInteger(s) || s <= 0 || s >= N) {
    return null;
  }

  const mu = s / N;
  const direction =
    forcedDirection ||
    (mu < 0.5 ? "up" : mu > 0.5 ? "down" : Math.random() < 0.5 ? "up" : "down");
  return xForTail(s, direction, TARGET_TAIL);
}

/**
 * The count X on one side of s whose binomial tail probability under
 * K ~ Binomial(n, s/n) is closest to `target`: P(K >= X) going "up",
 * P(K <= X) going "down". A smaller target means a more surprising result.
 * Only defined for 0 < s < n: the binomial is degenerate at 0 and n. An exact
 * tie prefers the less extreme X.
 */
function xForTail(s, direction, target, n = N) {
  if (!(s > 0 && s < n)) return null;
  const pmf = binomialPmf(n, s / n);

  let bestX = null;
  let bestDifference = Infinity;

  if (direction === "up") {
    const upperTail = new Array(n + 1);
    let tail = 0;

    for (let k = n; k >= 0; k -= 1) {
      tail += pmf[k];
      upperTail[k] = tail;
    }

    for (let x = s + 1; x <= n; x += 1) {
      const difference = Math.abs(upperTail[x] - target);
      if (difference < bestDifference - Number.EPSILON) {
        bestDifference = difference;
        bestX = x;
      }
    }
  } else {
    const lowerTail = new Array(n + 1);
    let tail = 0;

    for (let k = 0; k <= n; k += 1) {
      tail += pmf[k];
      lowerTail[k] = tail;
    }

    for (let x = s - 1; x >= 0; x -= 1) {
      const difference = Math.abs(lowerTail[x] - target);
      if (difference < bestDifference - Number.EPSILON) {
        bestDifference = difference;
        bestX = x;
      }
    }
  }

  return bestX;
}

/**
 * Binomial(n, mu) probabilities for k = 0..n, built in log space and scaled by
 * the largest term: the simple recurrence from (1 - mu)^n underflows to zero
 * once n is in the thousands.
 */
function binomialPmf(n, mu) {
  const logMu = Math.log(mu), log1mMu = Math.log1p(-mu), logGammaN = logGamma(n + 1);
  const logPmf = Array.from({ length: n + 1 }, (_, k) =>
    logGammaN - logGamma(k + 1) - logGamma(n - k + 1) + k * logMu + (n - k) * log1mMu);
  const max = Math.max(...logPmf);
  const pmf = logPmf.map(v => Math.exp(v - max));
  // Normalisation also absorbs the error in the log-gamma approximation.
  const total = pmf.reduce((sum, probability) => sum + probability, 0);
  return pmf.map(p => p / total);
}

/**
 * BETA FIT
 * --------
 * The updated estimate is converted to mu'=updated_successes/100, then:
 *   nu    = (X - N*mu') / (mu' - mu)
 *   alpha = mu*nu
 *   beta  = (1-mu)*nu
 * The strict-between check is essential: without it, nu cannot represent a
 * positive, finite Beta concentration.
 */
export function calculateBetaFit(rawS, rawX, rawUpdated) {
  const s = Number(rawS);
  const x = Number(rawX);
  const updated = Number(rawUpdated);

  if (![s, x, updated].every(Number.isFinite)) {
    return { valid: false, reason: "Enter a finite numeric updated estimate." };
  }

  const mu = s / N;
  const evidenceRate = x / N;
  const muPrime = updated / N;
  const lower = Math.min(mu, evidenceRate);
  const upper = Math.max(mu, evidenceRate);

  if (!(muPrime > lower + NUMERIC_EPSILON && muPrime < upper - NUMERIC_EPSILON)) {
    return {
      valid: false,
      reason: `Your updated estimate must be strictly between ${formatCount(
        Math.min(s, x),
      )} and ${formatCount(Math.max(s, x))} successes out of 100.`,
    };
  }

  const denominator = muPrime - mu;
  const nu = (x - N * muPrime) / denominator;
  const alpha = mu * nu;
  const beta = (1 - mu) * nu;

  if (
    !Number.isFinite(nu) ||
    nu <= 0 ||
    !Number.isFinite(alpha) ||
    alpha <= 0 ||
    !Number.isFinite(beta) ||
    beta <= 0
  ) {
    return {
      valid: false,
      reason:
        "These answers do not imply a positive, finite Beta distribution. Please adjust the updated estimate.",
    };
  }

  return {
    valid: true,
    mu,
    muPrime,
    evidenceRate,
    nu,
    alpha,
    beta,
  };
}

// Lanczos log-gamma approximation used by the Beta density and CDF.
export function logGamma(z) {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  let adjusted = z - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index] / (adjusted + index + 1);
  }

  const t = adjusted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (adjusted + 0.5) * Math.log(t) -
    t +
    Math.log(series)
  );
}

export function betaContinuedFraction(a, b, x) {
  const maxIterations = 200;
  const fpMin = 1e-300;
  const convergence = 3e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let result = d;

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));

    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    result *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    result *= delta;

    if (Math.abs(delta - 1) < convergence) break;
  }

  return result;
}

export function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x),
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }

  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function betaQuantile(probability, alpha, beta) {
  if (probability <= 0) return 0;
  if (probability >= 1) return 1;

  let lower = 0;
  let upper = 1;

  for (let iteration = 0; iteration < 90; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (regularizedIncompleteBeta(midpoint, alpha, beta) < probability) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  return (lower + upper) / 2;
}

export function betaDensity(x, alpha, beta) {
  const boundedX = Math.min(1 - 1e-7, Math.max(1e-7, x));
  const logBeta = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
  const logDensity =
    (alpha - 1) * Math.log(boundedX) +
    (beta - 1) * Math.log1p(-boundedX) -
    logBeta;
  return Math.exp(Math.min(logDensity, 700));
}


/**
 * UPDATE CLASSIFICATION
 * ---------------------
 * Records how the updated estimate relates to the prior (s) and the
 * hypothetical evidence (x) so incoherent answers are countable rather than
 * merely absent. Coherent Bayesian updating lands strictly between the two.
 */
export function classifyUpdate(s, x, updated) {
  if (![s, x, updated].every(Number.isFinite)) return "not_applicable";
  if (updated === s) return "no_change";
  if (updated === x) return "matched_evidence";

  const towardEvidence = Math.sign(x - s);
  const actualMove = Math.sign(updated - s);

  if (actualMove !== towardEvidence) return "away_from_evidence";

  return Math.abs(updated - s) > Math.abs(x - s)
    ? "overshoot_past_evidence"
    : "toward_evidence";
}

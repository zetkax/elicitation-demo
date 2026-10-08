/**
 * Pure elicitation maths. No DOM, no SurveyJS, no config -- so every consumer
 * (the survey, the tests, any future replay tool) computes identical numbers.
 */
import { formatCount } from "./format.js";

export const N = 100;
export const TARGET_TAIL = 0.1;
export const NUMERIC_EPSILON = 1e-12;

// The hypothetical evidence for the Update format is chosen in evidence.js.

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

/**
 * THE UPDATE FIT (Hypothetical Future Samples)
 * -------------------------------------------
 * The initial estimate s (out of `scale`) is the participant's EXPECTED success
 * rate, p0 = s / scale, and so fixes the MEAN of an implied Beta prior. Each
 * hypothetical result is x successes out of `n` trials, rate q = x / n, and
 * the participant's updated expectation is p = updated / scale. A
 * Beta(p0*nu, (1-p0)*nu) prior updated on that result has mean
 *
 *   p = p0 + w * (q - p0),   with   w = n / (n + nu)
 *
 * so each answer implies its own weight w_i = (p_i - p0) / (q_i - p0) -- the
 * fraction of the way from p0 to the evidence the participant moved -- and,
 * for 0 < w_i < 1, its own prior strength nu_i = n * (1 - w_i) / w_i. Each
 * answer is classified (tolerance NUMERIC_TOLERANCE):
 *
 *   interior       0 < w < 1   moved part of the way towards the evidence
 *   no_movement    w = 0       stayed at p0 (infinite prior strength)
 *   full_movement  w = 1       moved exactly to the evidence (no prior strength)
 *   moved_away     w < 0       moved the other way: not this model
 *   overshoot      w > 1       moved past the evidence: not this model
 *
 * A single common weight is fitted by least squares across the answers,
 *   w_hat = sum (q_i - p0)(p_i - p0) / sum (q_i - p0)^2,
 * and, when it is strictly between 0 and 1, gives nu = n (1 - w_hat) / w_hat,
 * alpha = p0 * nu, beta = (1 - p0) * nu. Nothing is clamped. The fit is valid
 * only if p0 is strictly inside (0, 1), no answer moved away or overshot, and
 * 0 < w_hat < 1. So:
 *   - any moved_away / overshoot answer: invalid (reason names it); no curve
 *   - all no_movement (w_hat = 0) or all full_movement (w_hat = 1): invalid
 *   - interior answers that imply different strengths: valid; the spread is
 *     kept (per-answer w and nu, residuals, rmse)
 *   - one no_movement or full_movement answer beside an interior one: valid
 *     when w_hat is inside (0, 1), and flagged in diagnostics.degenerate
 * Each sample may carry a `direction` ("up" / "down"), kept in diagnostics.
 */
export const NUMERIC_TOLERANCE = 1e-9;
export function classifyWeight(w) {
  if (!Number.isFinite(w)) return 'not_applicable';
  if (Math.abs(w) <= NUMERIC_TOLERANCE) return 'no_movement';
  if (Math.abs(w - 1) <= NUMERIC_TOLERANCE) return 'full_movement';
  if (w < 0) return 'moved_away';
  if (w > 1) return 'overshoot';
  return 'interior';
}

export function fitBetaUpdates(rawS, samples, minimum = 2, n = N, scale = n) {
  // A boundary estimate is reported as such even before the updates are in:
  // at 0 or the top of the scale no proper Beta has that mean.
  if (numericAnswer(rawS) && (Number(rawS) <= 0 || Number(rawS) >= scale)) {
    return { valid: false, reason: "boundary_mean" };
  }
  if (!numericAnswer(rawS) || !Array.isArray(samples) || samples.length < minimum ||
      samples.some(r => !numericAnswer(r.x) || !numericAnswer(r.updated))) {
    return { valid: false, reason: "incomplete" };
  }
  const p0 = Number(rawS) / scale;
  if (samples.some(r => Number(r.x) < 0 || Number(r.x) > n || Number(r.updated) < 0 || Number(r.updated) > scale)) {
    return { valid: false, reason: "outside_count_range" };
  }
  const perResult = samples.map((r) => {
    const q = Number(r.x) / n;
    const p = Number(r.updated) / scale;
    const d = q - p0;
    const w = d === 0 ? NaN : (p - p0) / d;
    const classification = classifyWeight(w);
    return { direction: r.direction ?? null, q, p, w: Number.isFinite(w) ? w : null, classification,
      nu: classification === 'interior' ? n * (1 - w) / w : null };
  });
  const denominator = perResult.reduce((sum, r) => sum + (r.q - p0) ** 2, 0);
  const wHat = denominator ? perResult.reduce((sum, r) => sum + (r.q - p0) * (r.p - p0), 0) / denominator : NaN;
  const residuals = perResult.map(r => (r.p - (p0 + wHat * (r.q - p0))) * scale);
  const diagnostics = { method: "hfs_common_weight_least_squares_v2", n, scale, sampleCount: samples.length,
    p0, wHat: Number.isFinite(wHat) ? wHat : null, perResult,
    degenerate: perResult.filter(r => r.classification === 'no_movement' || r.classification === 'full_movement').map(r => r.direction ?? r.classification),
    residuals: residuals.map(v => (Number.isFinite(v) ? v : null)),
    rmse: Number.isFinite(wHat) ? Math.sqrt(residuals.reduce((sum, v) => sum + v * v, 0) / residuals.length) : null };

  const fail = (reason) => ({ valid: false, reason, diagnostics });
  if (!denominator) return fail("uninformative_evidence");
  if (perResult.some(r => r.classification === 'moved_away')) return fail("moved_away");
  if (perResult.some(r => r.classification === 'overshoot')) return fail("overshoot");
  const wClass = classifyWeight(wHat);
  if (wClass === 'no_movement') return fail("no_movement");
  if (wClass === 'full_movement') return fail("full_movement");
  if (wClass !== 'interior') return fail("no_fit");
  const nu = n * (1 - wHat) / wHat;
  const alpha = p0 * nu, beta = (1 - p0) * nu;
  if (![nu, alpha, beta].every(v => Number.isFinite(v) && v > 0)) return fail("no_fit");
  return { valid: true, mu: p0, nu, alpha, beta, weight: wHat, diagnostics };
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
export function binomialPmf(n, mu) {
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

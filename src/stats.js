/**
 * Pure elicitation maths. No DOM, no SurveyJS, no config -- so every consumer
 * (the survey, the tests, any future replay tool) computes identical numbers.
 */
import { formatCount } from "./format.js";

export const N = 100;
export const TARGET_TAIL = 0.1;
export const NUMERIC_EPSILON = 1e-12;
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
  const pmf = new Array(N + 1).fill(0);

  pmf[0] = Math.pow(1 - mu, N);
  for (let k = 0; k < N; k += 1) {
    pmf[k + 1] =
      pmf[k] * ((N - k) / (k + 1)) * (mu / (1 - mu));
  }

  // Normalisation guards against accumulated floating-point error.
  const total = pmf.reduce((sum, probability) => sum + probability, 0);
  for (let k = 0; k <= N; k += 1) {
    pmf[k] /= total;
  }

  let bestX = null;
  let bestDifference = Infinity;

  if (direction === "up") {
    const upperTail = new Array(N + 1);
    let tail = 0;

    for (let k = N; k >= 0; k -= 1) {
      tail += pmf[k];
      upperTail[k] = tail;
    }

    for (let x = s + 1; x <= N; x += 1) {
      const difference = Math.abs(upperTail[x] - TARGET_TAIL);
      if (difference < bestDifference - Number.EPSILON) {
        bestDifference = difference;
        bestX = x;
      }
    }
  } else {
    const lowerTail = new Array(N + 1);
    let tail = 0;

    for (let k = 0; k <= N; k += 1) {
      tail += pmf[k];
      lowerTail[k] = tail;
    }

    for (let x = s - 1; x >= 0; x -= 1) {
      const difference = Math.abs(lowerTail[x] - TARGET_TAIL);
      if (difference < bestDifference - Number.EPSILON) {
        bestDifference = difference;
        bestX = x;
      }
    }
  }

  return bestX;
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

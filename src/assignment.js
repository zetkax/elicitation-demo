/**
 * PARTICIPANT ASSIGNMENT
 * ----------------------
 * Everything random about what one participant sees is decided here, once,
 * before any page is built: the version (A/B/C), hence each question's
 * elicitation method; which Update question gets which evidence sample size;
 * the presentation order; the consistency-repeat target; and the
 * low-probability denominator. Pure: `rng` is injectable, so tests can drive
 * every branch, and nothing here touches SurveyJS or the DOM.
 */
import { VARIANTS, UPDATE_SAMPLE_SIZES, LOW_PROB_DENOMINATORS } from './design.js';
import { shuffle } from './stats.js';

/** "?variant=b" -> "B"; anything else -> null. */
export function parseVariant(search = '') {
  const raw = new URLSearchParams(search).get('variant');
  const v = raw && raw.trim().toUpperCase();
  return v && Object.hasOwn(VARIANTS, v) ? v : null;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/**
 * @param questions  the main questions, in questions.js order (Q1..Q6)
 * @param opts.variant  a forced variant (from the URL), or null for random
 * @returns { variant, variantSource, main, consistencyTarget, lowProbDenominator }
 *   `main` is in presentation order; each entry carries its question, method,
 *   update sample size (null unless Update) and 1-based position.
 */
export function assignParticipant(questions, { variant = null, rng = Math.random } = {}) {
  const variantSource = variant ? 'url' : 'random';
  const chosen = variant || pick(Object.keys(VARIANTS), rng);
  const methods = VARIANTS[chosen];
  if (methods.length !== questions.length) {
    throw new Error(`design.js: variant ${chosen} lists ${methods.length} methods for ${questions.length} questions`);
  }

  // Method first, by question; then the two Update sizes in random order.
  const entries = questions.map((question, i) => ({ id: question.id, question, method: methods[i], updateN: null }));
  const sizes = shuffle(UPDATE_SAMPLE_SIZES, rng);
  entries.filter((e) => e.method === 'update').forEach((e, i) => { e.updateN = sizes[i]; });

  // Only then the order: method and size travel with the question.
  const main = shuffle(entries, rng).map((e, i) => ({ ...e, position: i + 1 }));

  return {
    variant: chosen,
    variantSource,
    main,
    // The first Percentiles question actually shown is asked again near the end.
    consistencyTarget: main.find((e) => e.method === 'percentiles')?.id ?? null,
    lowProbDenominator: pick(LOW_PROB_DENOMINATORS, rng),
  };
}

/** The plan as stored with the response: enough to rebuild what was shown. */
export function planSummary(plan) {
  return plan.main.map(({ id, method, updateN, position }) => ({ id, method, n: updateN, position }));
}

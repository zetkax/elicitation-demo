/**
 * SURVEY DESIGN
 * -------------
 * The settings that decide what each participant is asked, kept apart from
 * the question content (questions.js, diagnostics.js) and from the survey
 * engine (app.js, pages/), so the pilot design can change in one place.
 */

export const METHODS = ['percentiles', 'chips', 'update'];

/**
 * Counterbalanced versions: the method for Q1..Q6, where Q1 is the first
 * question listed in questions.js, Q2 the second, and so on. Each version
 * gives every method to exactly two questions.
 */
export const VARIANTS = {
  A: ['percentiles', 'chips', 'update', 'percentiles', 'chips', 'update'],
  B: ['chips', 'update', 'percentiles', 'chips', 'update', 'percentiles'],
  C: ['update', 'percentiles', 'chips', 'update', 'percentiles', 'chips'],
};

// The two Update questions get one each, in random order.
export const UPDATE_SAMPLE_SIZES = [20, 100];
// Estimates and updated estimates are always "out of 100 comparable attempts";
// only the hypothetical evidence uses the sample sizes above.
export const ESTIMATE_SCALE = 100;
// Independent hypothetical results per Update question: one above and one
// below the initial expectation (evidence.js).
export const UPDATES_PER_QUESTION = 2;
// How surprising each hypothetical result is meant to be if the initial
// expectation were right: its one-sided binomial tail probability. A design
// choice for this pilot (moderately surprising but plausible), not a value
// from the literature.
export const TARGET_TAIL = 0.075;

// Chips / roulette: equal-width bins over 0-100%, each chip = 100/total % mass.
export const CHIPS = { bins: 10, total: 20 };

// The finer scale offered after "very rare" / "not certain" at 0 or 100.
export const FINE_SCALE = 10000;

/**
 * Where the standalone items appear: `after` is a presentation position (1-6)
 * of the main questions, so they are spread through the survey rather than
 * gathered into an obvious block. The delayed consistency repeat always comes
 * after the last main question, then the final comments.
 */
export const DIAGNOSTIC_PLACEMENT = [
  { id: 'bayes', after: 2 },
  { id: 'lowprob', after: 4 },
  { id: 'chain', after: 6 },
];

// The low-probability item is asked "out of" one of these, at random.
export const LOW_PROB_DENOMINATORS = [100, 1000];

// Training: the Update practice uses this evidence sample size.
export const PRACTICE_UPDATE_N = 100;

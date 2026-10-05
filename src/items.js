import { QUESTIONS } from './questions.js';

/**
 * Shared field registry. Every field of an item is `${prefix}_${name}`, so an
 * item's data always lands in the same spreadsheet columns -- for the main
 * questions, whatever position the random order put them in.
 */
export function makeItem(prefix, count = 1, { practice = false } = {}) {
  const key = base => `${prefix}_${base}`;
  const updates = Array.from({ length: count }, (_, i) => ({
    evidence: key(`generated_x${i ? `_${i + 1}` : ''}`),
    answer: key(`updated_successes${i ? `_${i + 1}` : ''}`),
  }));
  return { prefix, isPractice: practice, prior: key('prior_successes'), updates,
    generatedX: updates[0].evidence, updated: updates[0].answer,
    fitValid: key('fit_valid'), fitNu: key('fit_nu'), fitAlpha: key('fit_alpha'), fitBeta: key('fit_beta'),
    interval: key('credible_interval_90'), interval50: key('credible_interval_50'),
    diagnostics: key('fit_diagnostics'), classification: key('update_classification'),
    outOfRange: key('updated_out_of_0_100'), invalidReason: key('fit_invalid_reason'),
    widthCheck: key('width_check'),
    // Which kind each hypothetical result was, in display order, e.g.
    // ["jump","extreme","middle"]. Needed because the numbers are random.
    evidenceKinds: key('evidence_kinds'),
    // Main questions only: where in the random order it was shown (1-6), and
    // the per-question "Source of uncertainty" answers (questions currently
    // commented out in pages/main.js), and how easy the question was to understand (1-5).
    position: key('position'),
    clarityRating: key('clarity_rating'),
    uncertaintySource: key('uncertainty_source'),
    uncertaintySourceOther: key('uncertainty_source_other'),
    uncertaintyReducible: key('uncertainty_reducible'),
    // Free text: what would have helped them answer, incl. any restatement.
    missingInfo: key('missing_info') };
}

export const PRACTICE_ITEMS = [
  makeItem('practice1', 1, { practice: true }),
  makeItem('practice2', 3, { practice: true }),
];
// One item per main question, in the order questions.js lists them (not the
// order a respondent sees them -- that is shuffled per respondent).
export const QUESTION_ITEMS = QUESTIONS.map((q) => ({ ...makeItem(q.id, 3), question: q }));
export const ALL_ITEMS = [...PRACTICE_ITEMS, ...QUESTION_ITEMS];
// Every item whose three updates are fitted together and then checked.
export const THREE_UPDATE_ITEMS = ALL_ITEMS.filter((i) => i.updates.length === 3);

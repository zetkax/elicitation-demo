import { QUESTIONS } from './questions.js';
import { N, RARE_N } from './stats.js';

/**
 * Shared field registry. Every field of an item is `${prefix}_${name}`, so an
 * item's data always lands in the same spreadsheet columns -- for the main
 * questions, whatever position the random order put them in.
 */
const COUNT_NAMES = { prior: 'prior_successes', updated: 'updated_successes', outOfRange: 'updated_out_of_0_100' };

/**
 * `n` is the number of imagined trials and `label` the words used for what is
 * counted ({ noun: 'successes', verb: 'succeed' }); both feed the page text.
 */
export function makeItem(prefix, count = 1, { practice = false, n = N, names = COUNT_NAMES,
  label = { noun: 'successes', verb: 'succeed' } } = {}) {
  const key = base => `${prefix}_${base}`;
  const updates = Array.from({ length: count }, (_, i) => ({
    evidence: key(`generated_x${i ? `_${i + 1}` : ''}`),
    answer: key(`${names.updated}${i ? `_${i + 1}` : ''}`),
  }));
  return { prefix, isPractice: practice, n, label, prior: key(names.prior), updates,
    generatedX: updates[0].evidence, updated: updates[0].answer,
    fitValid: key('fit_valid'), fitNu: key('fit_nu'), fitAlpha: key('fit_alpha'), fitBeta: key('fit_beta'),
    interval: key('credible_interval_90'), interval50: key('credible_interval_50'),
    diagnostics: key('fit_diagnostics'), classification: key('update_classification'),
    outOfRange: key(names.outOfRange), invalidReason: key('fit_invalid_reason'),
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
export const QUESTION_ITEMS = QUESTIONS.map((q) => {
  const item = makeItem(q.id, 3);
  return { ...item, question: q,
    // Asked only after an initial estimate of 0 or 100: "impossible" or
    // "very_rare" ("impossible" covers "certain" at 100: failure is impossible).
    boundaryMeaning: `${q.id}_boundary_meaning`,
    rare: makeRareItem(q.id) };
});

/**
 * The finer scale offered after "very rare": the same three-update format,
 * out of RARE_N trials, counting whichever outcome is rare -- successes after
 * an estimate of 0, failures after 100. Its columns all start `<id>_rare_`
 * and every number in them (counts, fit, intervals) is about that rare
 * outcome; `<id>_rare_outcome` says which ("success" or "failure").
 *
 * The page text names the outcome through survey variables (`<id>_rare_noun`,
 * `<id>_rare_verb`, `<id>_rare_subject`), set by app.js when the initial
 * estimate is answered.
 */
function makeRareItem(id) {
  const prefix = `${id}_rare`;
  const item = makeItem(prefix, 3, {
    n: RARE_N,
    names: { prior: 'prior', updated: 'updated', outOfRange: 'updated_out_of_range' },
    label: { noun: `{${prefix}_noun}`, verb: `{${prefix}_verb}` },
  });
  const outcome = `${prefix}_outcome`;
  const dataKeys = [outcome, item.prior, ...item.updates.flatMap((u) => [u.evidence, u.answer]), item.evidenceKinds,
    item.fitValid, item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50, item.diagnostics,
    item.classification, item.outOfRange, item.invalidReason, item.widthCheck];
  return { ...item, isRare: true, parent: id, outcome, dataKeys,
    vars: { noun: `${prefix}_noun`, verb: `${prefix}_verb`, subject: `${prefix}_subject` } };
}
export const RARE_ITEMS = QUESTION_ITEMS.map((i) => i.rare);
export const ALL_ITEMS = [...PRACTICE_ITEMS, ...QUESTION_ITEMS, ...RARE_ITEMS];
// Every item whose three updates are fitted together and then checked.
export const THREE_UPDATE_ITEMS = ALL_ITEMS.filter((i) => i.updates.length === 3);

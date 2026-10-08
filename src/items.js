import { QUESTIONS } from './questions.js';
import { ESTIMATE_SCALE, FINE_SCALE, UPDATES_PER_QUESTION, PRACTICE_UPDATE_N } from './design.js';

/**
 * Shared field registry. Every field is `${prefix}_${name}`, and a main
 * question's prefix is its id, so its data always lands in the same
 * spreadsheet columns whatever position, method or sample size it was given.
 * docs/response-schema.md lists every column.
 */
const COUNT_NAMES = { prior: 'prior_successes', updated: 'updated_successes', outOfRange: 'updated_out_of_0_100' };

/**
 * The Update format: an initial estimate, `count` independent hypothetical
 * results, an updated estimate for each, and the joint fit.
 *   n      hypothetical trials per result (20 or 100; 10,000 on the fine scale)
 *   scale  what the estimate and updated estimates are out of (100, or 10,000)
 *   label  the words for what is counted, for the page text
 *   prior  overrides the initial-estimate field (the fine scale reuses the
 *          0/100 follow-up's own estimate)
 */
export function makeUpdateItem(prefix, { count = UPDATES_PER_QUESTION, n = 100, scale = ESTIMATE_SCALE,
  practice = false, names = COUNT_NAMES, label = { noun: 'successes', verb: 'succeed' }, prior } = {}) {
  const key = base => `${prefix}_${base}`;
  const updates = Array.from({ length: count }, (_, i) => ({
    evidence: key(`generated_x${i ? `_${i + 1}` : ''}`),
    answer: key(`${names.updated}${i ? `_${i + 1}` : ''}`),
  }));
  return { prefix, isPractice: practice, n, scale, label, prior: prior || key(names.prior), updates,
    fitValid: key('fit_valid'), fitNu: key('fit_nu'), fitAlpha: key('fit_alpha'), fitBeta: key('fit_beta'),
    interval: key('credible_interval_90'), interval50: key('credible_interval_50'),
    // The fit's 10th / 50th / 90th percentiles, out of `scale` (100, or 10,000
    // on the fine scale): directly comparable with the Percentiles format.
    fitP10: key('fit_p10'), fitP50: key('fit_p50'), fitP90: key('fit_p90'),
    diagnostics: key('fit_diagnostics'), classification: key('update_classification'),
    outOfRange: key(names.outOfRange), invalidReason: key('fit_invalid_reason'),
    widthCheck: key('width_check'),
    // Which kind each hypothetical result was, in display order, e.g.
    // ["jump","extreme","middle"], and how surprising each was: its binomial
    // tail probability under the initial estimate (see evidence.js).
    evidenceKinds: key('evidence_kinds'), evidenceTails: key('evidence_tails') };
}

export const percentileFields = (prefix) => ({ p10: `${prefix}_p10`, p50: `${prefix}_p50`, p90: `${prefix}_p90` });

/**
 * A smooth (Beta) approximation fitted to Percentiles answers or a Chips
 * allocation (fitting.js). Stored beside the raw answers, never instead of
 * them. Percentiles are out of 100, like the raw p10/p50/p90. For a main
 * question the prefix is its id, so these are the same <id>_fit_* columns an
 * Update question's fit uses: every main question has fit_p10/p50/p90.
 */
export const makeShapeFit = (prefix) => {
  const key = base => `${prefix}_fit_${base}`;
  const fit = { alpha: key('alpha'), beta: key('beta'), p10: key('p10'), p50: key('p50'), p90: key('p90'),
    rmse: key('rmse'), valid: key('valid'), method: key('method'), invalidReason: key('invalid_reason') };
  fit.dataKeys = Object.values(fit);
  return fit;
};

/**
 * THE 0 / MAXIMUM FOLLOW-UP
 * An answer at either end of a scale is followed by "impossible, or merely
 * very rare?" (at 0) or "certain, or extremely likely but not certain?" (at
 * the maximum). For "very rare" / "not certain" the participant then gives a
 * count out of FINE_SCALE of whichever outcome is rare. The original answer is
 * never changed; these are extra columns:
 *   <prefix>_boundary_meaning      impossible | very_rare | certain | not_certain
 *   <prefix>_boundary_fine         the count out of FINE_SCALE
 *   <prefix>_boundary_fine_counts  what that count counts (e.g. successes or failures)
 *
 * `words` gives the wording: `occurs` / `doesNotOccur` as clauses ("the agent
 * succeeds"), `counts` as [at 0, at max] ("successes", "failures"),
 * `verbs` likewise, and `units` ("attempts").
 */
export const MAIN_WORDS = { occurs: 'the agent succeeds', doesNotOccur: 'the agent fails',
  counts: ['successes', 'failures'], verbs: ['succeed', 'fail'], units: 'comparable attempts' };

export function makeBoundary(prefix, { source, max = ESTIMATE_SCALE, words = MAIN_WORDS }) {
  const key = base => `${prefix}_boundary_${base}`;
  const boundary = { prefix, source, max, words, fineScale: FINE_SCALE,
    meaning: key('meaning'), fine: key('fine'), fineCounts: key('fine_counts'),
    // Survey calculated values (not saved) that word the follow-up for 0 or max.
    calc: { question: key('question'), clause: key('clause'), noun: key('noun'), verb: key('verb') } };
  boundary.dataKeys = [boundary.meaning, boundary.fine, boundary.fineCounts];
  return boundary;
}

/**
 * One main question's fields. Which ones are used depends on the method the
 * participant was assigned; the names do not, so the columns stay stable.
 * `updateN` is that participant's evidence sample size for this question.
 */
export function makeQuestionItem(question, { method = null, updateN = 100 } = {}) {
  const id = question.id;
  const key = base => `${id}_${base}`;
  const update = makeUpdateItem(id, { n: updateN });
  const percentiles = percentileFields(id);
  // The follow-up hangs off the median for Percentiles, the initial estimate for Update.
  const boundary = method === 'percentiles' ? makeBoundary(id, { source: percentiles.p50 })
    : method === 'update' ? makeBoundary(id, { source: update.prior }) : null;
  return {
    id, prefix: id, question,
    method: key('method'), position: key('position'), updateN: key('update_n'),
    formatRating: key('format_rating'), missingInfo: key('missing_info'),
    // Main questions: "does this distribution represent your uncertainty?"
    // and the revision loop around it (see FEEDBACK_OPTIONS and app.js).
    feedback: {
      page: `${id}_feedback`, judgment: key('fit_feedback'), other: key('fit_feedback_other'),
      firstJudgment: key('fit_feedback_first'), firstOther: key('fit_feedback_first_other'),
      revisionCount: key('revision_count'), editRequests: key('edit_requests'), history: key('revision_history'),
      original: (field) => `${id}_original_${field.slice(id.length + 1)}`,
    },
    percentiles, chips: key('chips'), update, boundary,
    // Percentiles / Chips only: the smooth approximation (see makeShapeFit).
    shapeFit: method === 'percentiles' || method === 'chips' ? makeShapeFit(id) : null,
    // Update only: "very rare" / "not certain" repeats the Update format on
    // the fine scale, counting the rare outcome. Its estimate is the
    // follow-up's own count; every number in it is about that rare outcome.
    rare: method === 'update' ? makeRareItem(id, boundary) : null,
  };
}

function makeRareItem(id, boundary) {
  const item = makeUpdateItem(`${id}_rare`, {
    n: FINE_SCALE, scale: FINE_SCALE, prior: boundary.fine,
    names: { prior: 'prior', updated: 'updated', outOfRange: 'updated_out_of_range' },
    label: { noun: `{${boundary.calc.noun}}`, verb: `{${boundary.calc.verb}}` },
  });
  return { ...item, isRare: true, parent: id, boundary,
    dataKeys: [...item.updates.flatMap((u) => [u.evidence, u.answer]), item.evidenceKinds, item.evidenceTails,
      item.fitValid, item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50,
      item.fitP10, item.fitP50, item.fitP90, item.diagnostics,
      item.classification, item.outOfRange, item.invalidReason, item.widthCheck] };
}

/**
 * What a main question's feedback-and-revision loop compares and keeps: the
 * raw answer fields for its method (an answer counts as revised when any of
 * these changes) and the fit fields shown back. Originals of both are copied
 * to <id>_original_<field> the first time the feedback page is reached.
 */
export function feedbackFields(item, method) {
  const b = item.boundary ? [item.boundary.meaning, item.boundary.fine, item.boundary.fineCounts] : [];
  if (method === 'percentiles') {
    const f = item.shapeFit;
    return { raw: [...Object.values(item.percentiles), ...b], fit: [f.alpha, f.beta, f.p10, f.p50, f.p90, f.rmse, f.valid, f.method, f.invalidReason] };
  }
  if (method === 'chips') {
    const f = item.shapeFit;
    return { raw: [item.chips], fit: [f.alpha, f.beta, f.p10, f.p50, f.p90, f.rmse, f.valid, f.method, f.invalidReason] };
  }
  const u = item.update;
  return {
    raw: [u.prior, ...u.updates.flatMap((r) => [r.evidence, r.answer]), u.evidenceKinds, ...b],
    fit: [u.fitAlpha, u.fitBeta, u.fitNu, u.fitP10, u.fitP50, u.fitP90, u.fitValid, u.invalidReason],
  };
}

// Training: one practice of each format, on the same scenario.
export const PRACTICE = {
  percentiles: percentileFields('practice'),
  percentilesFit: makeShapeFit('practice_percentiles'),
  chips: 'practice_chips',
  chipsFit: makeShapeFit('practice_chips'),
  update: makeUpdateItem('practice', { n: PRACTICE_UPDATE_N, practice: true }),
};

// Standalone items (content in diagnostics.js).
export const DIAG_FIELDS = {
  bayes: { answer: 'diag_bayes_estimate' },
  chain: { answer: 'diag_chain_estimate' },
  lowprob: { answer: 'diag_lowprob_answer', denominator: 'diag_lowprob_denominator', probability: 'diag_lowprob_probability' },
};
export const CONSISTENCY = { target: 'consistency_target', answer: 'consistency_repeat_estimate' };

export const QUESTION_IDS = QUESTIONS.map((q) => q.id);

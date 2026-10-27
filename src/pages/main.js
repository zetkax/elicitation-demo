import { countQuestion, percentileElements, chipsElements, updateSequence, RATE_ESTIMATE_QUESTION } from './methods.js';
import { formatRatingPage, feedbackPage, boundaryPages, updateBoundaryPages, zeroFollowUpPages, boundaryCalculatedValues, notAtBoundary, fineChosen,
  numericItemPage, backgroundPage, finalCommentsPage } from './blocks.js';
import { SHARED_CONTEXT } from '../questions.js';
import { DIAGNOSTICS } from '../diagnostics.js';
import { LOW_PROB_FINE_SCALE } from '../design.js';
import { makeQuestionItem, makeBoundary, DIAG_FIELDS, CONSISTENCY } from '../items.js';

const METHOD_NAMES = { percentiles: 'Percentiles', chips: 'Chips', update: 'Update' };

/**
 * The main survey for one participant, from their plan (assignment.js):
 * shared context, then each main question in presentation order in its
 * assigned format, each followed by the response-format rating; then the
 * delayed consistency repeat; then the three standalone items, each with its
 * own follow-up pages, in the participant's `diagnosticOrder`; then the
 * background questions and the final comments.
 *
 * Page and field names come from each question's id, never its position, so
 * the random order changes only what is shown -- not where the data lands.
 *
 * Returns the pages plus what app.js needs to run them: the calculated values
 * that word the 0/100 follow-ups, each main question's fields (`entries`),
 * and every follow-up (`boundaries`).
 */
export function buildMainSection(plan) {
  const total = plan.main.length;
  const entries = plan.main.map((e) => ({ ...e, item: makeQuestionItem(e.question, { method: e.method, updateN: e.updateN }) }));
  const boundaries = entries.map((e) => e.item.boundary).filter(Boolean);
  const pages = [sharedContextPage(total)];

  const diagnostics = diagnosticSection(plan);
  boundaries.push(...diagnostics.boundaries);
  for (const entry of entries) {
    const heading = (name) => `Question ${entry.position} of ${total}\n${name}`;
    pages.push(...questionPages(entry, heading).map(withContextReminder));
  }

  const repeat = consistencySection(plan, entries);
  boundaries.push(...repeat.boundaries);
  pages.push(...repeat.pages);
  pages.push(...plan.diagnosticOrder.flatMap((id) => diagnostics.pages[id]));
  pages.push(backgroundPage, finalCommentsPage);

  // A zero-only follow-up has its own fixed wording, so no calculated values.
  return { pages, calculatedValues: boundaries.filter((b) => !b.zeroOnly).flatMap(boundaryCalculatedValues), entries, boundaries };
}

function questionPages({ item, method, question }, heading) {
  const scenario = { type: 'html', name: `${item.id}_scenario`, html: question.scenario };
  // Every format: answer -> the curve it implies -> accept or revise -> rating.
  const feedback = (opts = {}) => feedbackPage(item, { title: heading('Your uncertainty'), ...opts });
  const rating = formatRatingPage(item, heading('About this response format'));

  if (method === 'percentiles') {
    return [
      { name: `${item.id}_percentiles`, title: heading(METHOD_NAMES.percentiles), elements: [scenario, ...percentileElements(item.percentiles)] },
      ...boundaryPages(item.boundary, { title: heading(METHOD_NAMES.percentiles),
        recap: `<p>You gave a median long-run success rate of <strong>{${item.percentiles.p50}}%</strong>.</p>` }),
      feedback(),
      rating,
    ];
  }

  if (method === 'chips') {
    return [
      { name: `${item.id}_chips`, title: heading(METHOD_NAMES.chips), elements: [scenario, ...chipsElements(item.chips)] },
      feedback(),
      rating,
    ];
  }

  // Update: an estimate of 1-99 runs the standard format. 0 or 100 asks what
  // was meant; "impossible" / "certain" ends there, and "very rare" / "failure
  // is possible" refines once out of 1,000 -- a refined 0 also ends there, and
  // a positive count runs the adaptive boundary branch: two results out of
  // 1,000 of the rare event. Either branch ends on the shared feedback page.
  const { update, boundary, rare } = item;
  const adaptive = `${fineChosen(boundary)} and {${boundary.fine}} > 0`;
  const [estimate, ...updatesAndFitCheck] = updateSequence(update, {
    heading,
    updateVisibleIf: notAtBoundary(boundary),
    estimatePage: {
      name: `${item.id}_estimate`,
      title: heading('Initial estimate'),
      elements: [scenario, countQuestion(update.prior, RATE_ESTIMATE_QUESTION, true)],
    },
  });
  const updates = updatesAndFitCheck.slice(0, -1);
  // The adaptive results; their own fit check is replaced by the shared page.
  const rareUpdates = updateSequence(rare, { heading, updateVisibleIf: adaptive, estimatePage: null }).slice(1, -1);
  return [
    estimate,
    ...updateBoundaryPages(boundary, { title: heading('Initial estimate'), scenario: question.scenario,
      recap: `<p>You estimated a long-run success rate of <strong>{${update.prior}}%</strong>.</p>` }),
    ...updates,
    ...rareUpdates,
    feedback({ visibleIf: `(${notAtBoundary(boundary)}) or (${adaptive})`,
      validIf: `({${update.fitValid}} = true or {${rare.fitValid}} = true)` }),
    rating,
  ];
}

/**
 * The standalone items, by id. The low-probability item is asked out of the
 * participant's assigned denominator, and its 0 / maximum answer gets the
 * same follow-up as the main questions.
 */
function diagnosticSection(plan) {
  const title = 'A short question';
  const { bayes, chain, lowprob } = DIAGNOSTICS;
  const denominator = plan.lowProbDenominator;
  const fill = (text) => text.replace('{denominator}', denominator.toLocaleString('en-US'))
    .replace('{fine}', LOW_PROB_FINE_SCALE.toLocaleString('en-US'));
  // Only an answer of 0 is followed up: this item is about small numbers.
  const shown = denominator.toLocaleString('en-US');
  const lowBoundary = { ...makeBoundary('diag_lowprob', { source: DIAG_FIELDS.lowprob.answer, max: denominator,
    fineScale: LOW_PROB_FINE_SCALE, words: { counts: ['occurrences', 'non_occurrences'],
      mismatch: [`That is not smaller than 1 in ${shown}. Enter a whole number from 0 to {max}, press Back to change your earlier answer, or press Continue again to keep this answer.`] } }),
    zeroOnly: true };
  const numeric = (d, extra = {}) => numericItemPage({ name: `diag_${d.id}`, title, html: d.html,
    field: DIAG_FIELDS[d.id].answer, question: d.question, min: d.min, max: d.max, integer: Boolean(d.integer), ...extra });
  return {
    boundaries: [lowBoundary],
    pages: {
      bayes: [numeric(bayes)],
      chain: [numeric(chain)],
      lowprob: [
        numeric(lowprob, { max: denominator, question: fill(lowprob.question) }),
        ...zeroFollowUpPages(lowBoundary, { title, question: lowprob.zeroQuestion,
          choices: Object.fromEntries(Object.entries(lowprob.zeroChoices).map(([k, v]) => [k, fill(v)])),
          fineQuestion: fill(lowprob.fineQuestion) }),
      ],
    },
  };
}

/**
 * The delayed repeat: the first Percentiles question the participant saw,
 * asked again for its MEDIAN only (not an expected value), on the same 0-100
 * scale with decimals, so it compares like for like with that question's p50.
 * Their earlier answer is not shown.
 */
export const CONSISTENCY_QUESTION = {
  title: 'What is your median estimate of the agent’s long-run success rate?',
  description: 'This is the value you consider equally likely to be above or below. Enter a number from 0 to 100. Decimals are welcome.',
};
function consistencySection(plan, entries) {
  const target = entries.find((e) => e.id === plan.consistencyTarget);
  if (!target) return { pages: [], boundaries: [] };
  const boundary = makeBoundary('consistency_repeat', { source: CONSISTENCY.answer });
  const title = 'One more estimate';
  return {
    boundaries: [boundary],
    pages: [
      { name: 'consistency_repeat', title, elements: [
        { type: 'html', name: 'consistency_repeat_scenario', html: target.question.scenario },
        { ...countQuestion(CONSISTENCY.answer, CONSISTENCY_QUESTION.title), description: CONSISTENCY_QUESTION.description },
      ] },
      ...boundaryPages(boundary, { title,
        recap: `<p>You gave a median long-run success rate of <strong>{${CONSISTENCY.answer}}%</strong>.</p>` }),
    ].map(withContextReminder),
  };
}

// The shared context in full, once, before the first question.
function sharedContextPage(total) {
  return {
    name: 'shared_context',
    title: `Before the questions\nShared context`,
    elements: [
      {
        type: 'html',
        name: 'shared_context_text',
        html: `
          <section class="scenario-card" aria-label="Shared context">
            <span class="scenario-eyebrow">Applies to all ${total} questions</span>
            ${SHARED_CONTEXT}
          </section>
          <p class="context-note">A reminder of this stays at the top of every question page; click it to open it again.</p>`,
      },
    ],
  };
}

// Then a collapsed one-line reminder at the top of every question page:
// always to hand, but closed by default so it does not compete with the question.
function withContextReminder(page) {
  return {
    ...page,
    elements: [
      {
        type: 'html',
        name: `${page.name}_shared_context`,
        html: `
          <details class="context-reminder">
            <summary>Shared context (applies to every question)</summary>
            <div class="context-reminder__body">${SHARED_CONTEXT}</div>
          </details>`,
      },
      ...page.elements,
    ],
  };
}


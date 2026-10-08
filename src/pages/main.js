import { countQuestion, percentileElements, chipsElements, updateSequence } from './methods.js';
import { formatRatingPage, feedbackPage, boundaryPages, boundaryCalculatedValues, notAtBoundary, fineChosen,
  numericItemPage, finalCommentsPage } from './blocks.js';
import { SHARED_CONTEXT } from '../questions.js';
import { DIAGNOSTICS } from '../diagnostics.js';
import { DIAGNOSTIC_PLACEMENT } from '../design.js';
import { makeQuestionItem, makeBoundary, DIAG_FIELDS, CONSISTENCY } from '../items.js';

const METHOD_NAMES = { percentiles: 'Percentiles', chips: 'Chips', update: 'Update' };

/**
 * The main survey for one participant, from their plan (assignment.js):
 * shared context, then each main question in presentation order in its
 * assigned format, each followed by the response-format rating; the
 * standalone items at the positions in DIAGNOSTIC_PLACEMENT; then the delayed
 * consistency repeat and final comments.
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
    pages.push(...DIAGNOSTIC_PLACEMENT.filter((d) => d.after === entry.position).flatMap((d) => diagnostics.pages[d.id]));
  }

  const repeat = consistencySection(plan, entries);
  boundaries.push(...repeat.boundaries);
  pages.push(...repeat.pages, finalCommentsPage);

  return { pages, calculatedValues: boundaries.flatMap(boundaryCalculatedValues), entries, boundaries };
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
        recap: `<p>You gave a 50th percentile of <strong>{${item.percentiles.p50}} successes out of 100</strong> comparable attempts.</p>` }),
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

  // Update: an estimate of 0 or 100 replaces the usual updates with the
  // follow-up; "very rare" / "not certain" then repeats the format on the
  // fine scale, starting from the follow-up's own count.
  const { update, boundary, rare } = item;
  // The shared feedback page takes the place of the fit check that ends the
  // usual sequence; the fine-scale block keeps its own.
  const [estimate, ...updatesAndFitCheck] = updateSequence(update, {
    heading,
    updateVisibleIf: notAtBoundary(boundary),
    estimatePage: {
      name: `${item.id}_estimate`,
      title: heading('Initial estimate'),
      elements: [scenario, countQuestion(update.prior,
        'Imagine 100 comparable attempts under these conditions. In how many would you expect the agent to succeed?', true)],
    },
  });
  const updates = updatesAndFitCheck.slice(0, -1);
  const [, ...rareUpdates] = updateSequence(rare, { heading, updateVisibleIf: fineChosen(boundary), estimatePage: null });
  const rareFitCheck = rareUpdates.pop();
  return [
    estimate,
    ...boundaryPages(boundary, { title: heading('Initial estimate'), scenario: question.scenario,
      recap: `<p>You estimated that the agent would succeed in <strong>{${update.prior}} of 100</strong> comparable attempts.</p>` }),
    ...updates,
    // At 0 or 100 there is no curve to show: the follow-up covers it instead.
    feedback({ visibleIf: notAtBoundary(boundary) }),
    ...rareUpdates,
    { ...rareFitCheck, visibleIf: `${fineChosen(boundary)} and {${rare.fitValid}} = true` },
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
  const lowBoundary = makeBoundary('diag_lowprob', { source: DIAG_FIELDS.lowprob.answer, max: denominator,
    words: { occurs: lowprob.occurs, doesNotOccur: lowprob.doesNotOccur, counts: ['occurrences', 'non_occurrences'],
      verbs: ['happen', 'not happen'], units: lowprob.units } });
  const numeric = (d, extra = {}) => numericItemPage({ name: `diag_${d.id}`, title, html: d.html,
    field: DIAG_FIELDS[d.id].answer, question: d.question, min: d.min, max: d.max, integer: false, ...extra });
  return {
    boundaries: [lowBoundary],
    pages: {
      bayes: [numeric(bayes)],
      chain: [numeric(chain)],
      lowprob: [
        numeric(lowprob, { max: denominator, question: lowprob.question.replace('{denominator}', denominator.toLocaleString('en-US')) }),
        ...boundaryPages(lowBoundary, { title,
          recap: `<p>You answered <strong>{${DIAG_FIELDS.lowprob.answer}}</strong> out of ${denominator.toLocaleString('en-US')} ${lowprob.units}.</p>` }),
      ],
    },
  };
}

/**
 * The delayed repeat: the first Percentiles question the participant saw,
 * asked again as a single point estimate. Their earlier answer is not shown.
 */
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
        countQuestion(CONSISTENCY.answer, 'Out of every 100 comparable attempts, about how many would you expect to succeed?', true),
      ] },
      ...boundaryPages(boundary, { title,
        recap: `<p>You estimated that about <strong>{${CONSISTENCY.answer}} of 100</strong> comparable attempts would succeed.</p>` }),
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


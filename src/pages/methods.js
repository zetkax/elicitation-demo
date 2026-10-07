/**
 * THE THREE ELICITATION FORMATS
 * -----------------------------
 * Builders for Percentiles, Chips and Update, used by both the training and
 * the main questions so the two always look and behave the same. Each takes
 * field names from items.js and returns SurveyJS elements or pages; nothing
 * here knows which question or participant it is for.
 */
import { CHIPS } from '../design.js';

const fmt = (n) => n.toLocaleString('en-US');

export const card = (name, html) => ({ type: 'html', name, html: `<section class="scenario-card">${html}</section>` });

export function countQuestion(name, title, initial = false, { n = 100, min = 0, max = n } = {}) {
  return { type: 'text', name, title, inputType: 'number', min, max,
    step: initial ? 1 : 'any', isRequired: true,
    description: initial ? `Enter a whole number from ${fmt(min)} to ${fmt(max)}.` : `Enter a number from ${fmt(min)} to ${fmt(max)}. Decimals are welcome.`,
    validators: [{ type: 'numeric', minValue: min, maxValue: max }],
    requiredErrorText: 'Enter your estimate before continuing.' };
}

/* ---------- Percentiles ---------- */

export const PERCENTILE_DEFINITIONS = {
  p10: 'You think there is a 10% chance the true success rate is lower than this.',
  p50: 'You think the true success rate is equally likely to be above or below this.',
  p90: 'You think there is a 10% chance the true success rate is higher than this.',
};

/** The three inputs; their order (p10 <= p50 <= p90) is checked in app.js. */
export function percentileElements(fields) {
  const input = (name, title, description) => ({
    type: 'text', name, title, description, inputType: 'number', min: 0, max: 100, step: 'any',
    isRequired: true, requiredErrorText: 'Enter a value before continuing.',
    validators: [{ type: 'numeric', minValue: 0, maxValue: 100 }],
  });
  return [
    { type: 'html', name: `${fields.p10}_intro`, html: `<p class="method-prompt">Give three values for the agent's
      true success rate, in % (0–100). Decimals are welcome.</p>` },
    input(fields.p10, '10th percentile (%)', PERCENTILE_DEFINITIONS.p10),
    input(fields.p50, '50th percentile (%)', PERCENTILE_DEFINITIONS.p50),
    input(fields.p90, '90th percentile (%)', PERCENTILE_DEFINITIONS.p90),
  ];
}

/* ---------- Chips ---------- */

/**
 * The chips widget is drawn by app.js into this host (see chips.js); the
 * allocation is stored at `field`, and Continue is blocked until every chip
 * is placed.
 */
export function chipsElements(field) {
  return [
    { type: 'html', name: `${field}_intro`, html: `<p class="method-prompt">Spread <strong>${CHIPS.total} chips</strong>
      over the ranges of the agent's true success rate. Put more chips where you think the true rate is more
      likely to be. Each chip is ${100 / CHIPS.total}% of your probability, so use all ${CHIPS.total}.</p>` },
    { type: 'html', name: `${field}_widget`, html: `<div class="chips-host" data-chips="${field}"></div>` },
  ];
}

/* ---------- Update ---------- */

/**
 * One hypothetical result and the updated estimate. The estimate is out of
 * item.scale; the evidence is a count out of item.n trials, which can differ
 * (20 trials, say, while estimates stay out of 100).
 */
export function updatePage(item, index, name, title) {
  const update = item.updates[index];
  const { n, scale, label } = item;
  return { name, title, elements: [
    { type: 'html', name: `${name}_context`, html: `<section class="evidence-card">
      <p><strong>Imagine this result only.</strong> Start from your original view; set aside any other hypothetical results.</p>
      <div class="evidence-grid"><div class="evidence-stat"><span>Your original estimate</span><strong>{${item.prior}} / ${fmt(scale)}</strong></div>
      <div class="evidence-stat"><span>Hypothetical ${label.noun}</span><strong>{${update.evidence}} / ${fmt(n)}</strong></div></div>
      <p class="evidence-caption">These ${fmt(n)} trials use the same agent, hardware, task and conditions. Results are accurate and representative; trials are independent.</p></section>` },
    countQuestion(update.answer, `If you saw only this result, out of the next ${fmt(scale)} comparable attempts, how many would ${label.verb}?`, false, { n: scale }),
  ] };
}

/**
 * The joint fit of an item's updates, then "too narrow / just right / too
 * wide". Hidden when nothing can be fitted (an initial estimate of 0 or 100),
 * so those respondents are not stranded on an empty page.
 */
export function fitCheckPage(item, name, title) {
  return { name, title, visibleIf: `{${item.fitValid}} = true`, elements: [
    card(`${name}_intro`, `<p>This is the distribution fitted to your answers together.</p>`),
    { type: 'html', name: `${name}_chart`, html: `<div data-fit-check="${item.prefix}"></div>` },
    { type: 'radiogroup', name: item.widthCheck, isRequired: true,
      title: 'How does the fitted distribution compare with your own uncertainty?',
      requiredErrorText: 'Choose one to continue.',
      choices: [
        { value: 'too_narrow', text: 'Too narrow' },
        { value: 'about_right', text: 'About right' },
        { value: 'too_wide', text: 'Too wide' },
      ] },
  ] };
}

export const updatePageName = (prefix, i) => `${prefix}_update${i ? `_${i + 1}` : ''}`;

/** Estimate, each hypothetical update, then the fit check. */
export function updateSequence(item, { estimatePage, heading, updateVisibleIf }) {
  const count = item.updates.length;
  return [
    estimatePage,
    ...item.updates.map((_, i) => ({
      ...updatePage(item, i, updatePageName(item.prefix, i), heading(`Hypothetical result ${i + 1} of ${count}`)),
      ...(updateVisibleIf ? { visibleIf: updateVisibleIf } : {}),
    })),
    fitCheckPage(item, `${item.prefix}_fit_check`, heading('Your fitted distribution')),
  ];
}

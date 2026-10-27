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

// All three formats ask about the same quantity: the agent's long-run
// success rate on a 0-100 scale (60 = about 60% of attempts succeed) -- not
// the count in one particular batch of attempts. Stored values are 0-100.
export const RATE_ESTIMATE_QUESTION = 'What long-run success rate do you expect for the agent?';

export const PERCENTILE_QUESTIONS = {
  p10: {
    title: '10th percentile of the long-run success rate',
    description: 'You think there is only a 10% chance that the rate is lower than this.',
  },
  p50: {
    title: '50th percentile (your median) of the long-run success rate',
    description: 'You think the rate is equally likely to be above or below this.',
  },
  p90: {
    title: '90th percentile of the long-run success rate',
    description: 'You think there is only a 10% chance that the rate is higher than this.',
  },
};

/**
 * The three inputs; their order (p10 <= p50 <= p90) is checked in app.js.
 * `prompt: false` leaves out the instruction line, for a page that explains
 * the format itself (the training).
 */
export function percentileElements(fields, { prompt = true } = {}) {
  const input = (name, { title, description }) => ({
    type: 'text', name, title, description, inputType: 'number', min: 0, max: 100, step: 'any',
    isRequired: true, requiredErrorText: 'Enter a value before continuing.',
    validators: [{ type: 'numeric', minValue: 0, maxValue: 100 }],
  });
  return [
    ...(prompt ? [{ type: 'html', name: `${fields.p10}_intro`, html: `<p class="method-prompt">Give three values for the agent’s
      long-run success rate, from 0 to 100. Decimals are welcome.</p>` }] : []),
    input(fields.p10, PERCENTILE_QUESTIONS.p10),
    input(fields.p50, PERCENTILE_QUESTIONS.p50),
    input(fields.p90, PERCENTILE_QUESTIONS.p90),
  ];
}

/* ---------- Chips ---------- */

// The same quantity as Percentiles: the long-run success rate. More chips in
// a range means that range is more probable -- not that the participant is
// more certain overall -- so the wording is about probability.
export const CHIPS_HEADING = 'Show how uncertain you are about the agent’s long-run success rate.';
export const CHIPS_PROMPT = `Distribute all ${CHIPS.total} chips across the ranges below to show where you think the
  long-run success rate lies. Each chip represents a ${100 / CHIPS.total}% probability. Put more chips in ranges you
  think are more likely.`;

/**
 * The chips widget is drawn by app.js into this host (see chips.js); the
 * allocation is stored at `field`, and Continue is blocked until every chip
 * is placed. `prompt: false` leaves out the instruction line, for a page
 * that explains the format itself (the training).
 */
export function chipsElements(field, { prompt = true } = {}) {
  return [
    ...(prompt ? [{ type: 'html', name: `${field}_intro`, html: `<p class="method-prompt"><strong>${CHIPS_HEADING}</strong><br>${CHIPS_PROMPT}</p>` }] : []),
    { type: 'html', name: `${field}_widget`, html: `<div class="chips-host" data-chips="${field}"></div>` },
  ];
}

/* ---------- Update ---------- */

/**
 * One hypothetical result and the updated estimate. Estimates are long-run
 * rates (0-100, or per 1,000 attempts in the adaptive branch); the evidence
 * is an observed count out of item.n trials.
 */
export function updatePage(item, index, name, title) {
  const update = item.updates[index];
  const { n, scale, label } = item;
  return { name, title, elements: [
    // Deliberately not "representative": a random sample can be unusual by
    // chance, and saying otherwise would tell participants how far to move.
    { type: 'html', name: `${name}_context`, html: `<section class="evidence-card">
      <p><strong>Imagine this result only.</strong> Start from your original view and set aside the other hypothetical result.</p>
      <div class="evidence-grid"><div class="evidence-stat"><span>Your original estimate</span><strong>${label.adaptive
        ? `{${item.prior}} ${label.noun} per ${fmt(scale)} attempts` : `{${item.prior}}% long-run success rate`}</strong></div>
      <div class="evidence-stat"><span>Hypothetical result</span><strong>{${update.evidence}} ${label.noun} in ${fmt(n)} trials</strong></div></div>
      <p class="evidence-caption">These trials use the same agent, hardware, task, and conditions. Assume the recorded outcomes are accurate, the trials are independent, and there were no unusual technical problems.</p></section>` },
    label.adaptive
      // The adaptive boundary branch: counts of the rare event out of 1,000,
      // to at most one decimal place (checked in app.js).
      ? { ...countQuestion(update.answer, `If you saw only this result, how many ${label.noun} per ${fmt(scale)} attempts would you now expect in the long run?`, false, { n: scale }),
          description: `Enter a number from 0 to ${fmt(scale)}. You can use one decimal place.` }
      : countQuestion(update.answer, 'If you saw only this result, what long-run success rate would you now expect for the agent?', false, { n: scale }),
  ] };
}

/**
 * The joint fit of an item's updates, then "too narrow / just right / too
 * wide". Hidden when nothing can be fitted (an initial estimate of 0 or 100),
 * so those respondents are not stranded on an empty page. `intro: null`
 * leaves out the introductory card (the training's feedback card has its own).
 */
export function fitCheckPage(item, name, title, { intro = '<p>This is the distribution fitted to your answers together.</p>', showWhenInvalid = false } = {}) {
  // `showWhenInvalid` keeps the page (and its explanation) when no curve can
  // be fitted; the width question then has nothing to ask about.
  const valid = `{${item.fitValid}} = true`;
  return { name, title, ...(showWhenInvalid ? {} : { visibleIf: valid }), elements: [
    ...(intro ? [card(`${name}_intro`, intro)] : []),
    { type: 'html', name: `${name}_chart`, html: `<div data-fit-check="${item.prefix}"></div>` },
    { type: 'radiogroup', name: item.widthCheck, isRequired: true, ...(showWhenInvalid ? { visibleIf: valid } : {}),
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
export function updateSequence(item, { estimatePage, heading, updateVisibleIf, fitIntro, fitShowWhenInvalid = false }) {
  const count = item.updates.length;
  return [
    estimatePage,
    ...item.updates.map((_, i) => ({
      ...updatePage(item, i, updatePageName(item.prefix, i), heading(`Hypothetical result ${i + 1} of ${count}`)),
      ...(updateVisibleIf ? { visibleIf: updateVisibleIf } : {}),
    })),
    fitCheckPage(item, `${item.prefix}_fit_check`, heading('Your fitted distribution'),
      { ...(fitIntro === undefined ? {} : { intro: fitIntro }), showWhenInvalid: fitShowWhenInvalid }),
  ];
}

/**
 * Training only: a host for the smooth curve implied by a practice answer
 * (drawn by app.js). Never used on a main question.
 */
export const feedbackElement = (name, key) => ({ type: 'html', name, html: `<div class="fit-shell" data-feedback="${key}"></div>` });

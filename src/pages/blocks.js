/**
 * REUSABLE BLOCKS
 * ---------------
 * The pieces that recur around the elicitation formats: the response-format
 * rating after each main question, the 0 / maximum follow-up, and a single
 * numeric question (the standalone diagnostics and the consistency repeat).
 */
import { card, countQuestion } from './methods.js';

const fmt = (n) => n.toLocaleString('en-US');

/* ---------- Response-format rating ---------- */

export const FORMAT_RATING_TITLE = 'How easy was it to understand how you were supposed to express your uncertainty using this response format?';

/** Straight after every main question, with the optional free-text box. */
export function formatRatingPage(item, title) {
  return {
    // No visibleIf: every main question reaches it, whatever path it took.
    name: `${item.prefix}_rating`,
    title,
    elements: [
      {
        type: 'radiogroup',
        name: item.formatRating,
        title: FORMAT_RATING_TITLE,
        isRequired: true,
        requiredErrorText: 'Choose one to continue.',
        choices: [
          { value: 1, text: '1 = Very difficult' },
          { value: 2, text: '2 = Difficult' },
          { value: 3, text: '3 = Neither difficult nor easy' },
          { value: 4, text: '4 = Easy' },
          { value: 5, text: '5 = Very easy' },
        ],
      },
      {
        // Optional: a required free-text box mostly collects "n/a". Answers
        // here show where a scenario is underspecified before it is used at scale.
        type: 'comment',
        name: item.missingInfo,
        title: 'What would have helped you answer this question better?',
        description:
          'For example, information you felt was missing, or anything that was unclear. If you like, restate the question, or any part of it, in your own words, the way you would rather have been asked. Please do not include anything that identifies you.',
        placeholder: 'Optional',
        rows: 4,
      },
    ],
  };
}

/* ---------- Fitted feedback and revision (main questions) ---------- */

export const FEEDBACK_QUESTION = 'Does this distribution roughly represent the uncertainty you intended to express?';
export const FEEDBACK_OPTIONS = [
  { value: 'about_right', text: 'Yes, it looks about right' },
  { value: 'too_narrow', text: 'It is too narrow' },
  { value: 'too_wide', text: 'It is too wide' },
  { value: 'centre_wrong', text: 'The centre is in the wrong place' },
  { value: 'other', text: 'Something else' },
];

/**
 * After a main question's answer, in any format: the smooth curve it implies
 * (drawn by app.js from `data-feedback`) and "does this represent what you
 * intended?". For anything but "about right", or when no curve could be
 * drawn, app.js puts Edit my answer in the navigation bar where Continue
 * usually is, with "Continue without changes" beside it.
 */
export function feedbackPage(item, { title, visibleIf, validIf } = {}) {
  const f = item.feedback;
  // `validIf`: when a curve exists to judge (Update also has the adaptive fit).
  const valid = validIf || `{${item.id}_fit_valid} = true`;
  return {
    name: f.page,
    title,
    ...(visibleIf ? { visibleIf } : {}),
    elements: [
      { type: 'html', name: `${f.page}_chart`, html: `<div class="fit-shell" data-feedback="${item.id}"></div>` },
      {
        type: 'radiogroup',
        name: f.judgment,
        title: FEEDBACK_QUESTION,
        // Nothing to judge when no curve could be drawn.
        visibleIf: valid,
        isRequired: true,
        requiredErrorText: 'Choose one to continue.',
        choices: FEEDBACK_OPTIONS,
      },
      {
        type: 'comment',
        name: f.other,
        title: 'What is wrong with it?',
        visibleIf: `{${f.judgment}} = 'other'`,
        placeholder: 'Optional',
        rows: 2,
      },
    ],
  };
}

/* ---------- The 0 / maximum follow-up ---------- */

// Expressions over a boundary (see makeBoundary in items.js).
export const atBoundary = (b) => `({${b.source}} = 0 or {${b.source}} = ${b.max})`;
// A skipped answer (possible while requireAnswers is off) is not at a boundary.
export const notAtBoundary = (b) => `({${b.source}} empty or ({${b.source}} > 0 and {${b.source}} < ${b.max}))`;
export const fineChosen = (b) => `${atBoundary(b)} and ({${b.meaning}} = 'very_rare' or {${b.meaning}} = 'not_certain')`;

export const BOUNDARY_QUESTIONS = [
  'Do you mean that you think this outcome is impossible, or merely very rare?',
  'Do you mean that you think this outcome is certain, or extremely likely but not certain?',
];

/** Survey-level calculated values that word the follow-up for 0 or the maximum. */
export function boundaryCalculatedValues(b) {
  const atMax = `{${b.source}} = ${b.max}`;
  const pick = (name, [atZero, atTop]) => ({ name, expression: `iif(${atMax}, '${atTop}', '${atZero}')` });
  return [
    pick(b.calc.question, BOUNDARY_QUESTIONS),
    pick(b.calc.clause, [b.words.occurs, b.words.doesNotOccur]),
    pick(b.calc.noun, b.words.counts),
    pick(b.calc.verb, b.words.verbs),
    ...(b.words.refine ? [pick(b.calc.refine, b.words.refine)] : []),
  ];
}

/**
 * Two pages: what the end-of-scale answer meant, then (for "very rare" / "not
 * certain") a count out of the fine scale of the rare outcome. `recap` is
 * HTML restating the original answer, which the participant can still see.
 */
export function boundaryPages(b, { title, recap, scenario }) {
  const fine = fmt(b.fineScale);
  return [
    {
      name: `${b.prefix}_boundary`,
      title,
      visibleIf: atBoundary(b),
      elements: [
        card(`${b.prefix}_boundary_recap`, recap),
        {
          type: 'radiogroup',
          name: b.meaning,
          title: `{${b.calc.question}}`,
          isRequired: true,
          requiredErrorText: 'Choose one to continue.',
          choices: [
            { value: 'impossible', text: 'Impossible', visibleIf: `{${b.source}} = 0` },
            { value: 'very_rare', text: 'Possible, but very rare', visibleIf: `{${b.source}} = 0` },
            { value: 'certain', text: 'Certain', visibleIf: `{${b.source}} = ${b.max}` },
            { value: 'not_certain', text: 'Extremely likely, but not certain', visibleIf: `{${b.source}} = ${b.max}` },
          ],
        },
      ],
    },
    {
      name: `${b.prefix}_boundary_scale`,
      title,
      visibleIf: fineChosen(b),
      elements: [
        card(`${b.prefix}_boundary_fine_intro`,
          `<p>So that very small chances can be told apart, please answer on a finer scale:
          <strong>${fine}</strong> ${b.words.units} instead of ${fmt(b.max)}.</p>`),
        ...(scenario ? [{ type: 'html', name: `${b.prefix}_boundary_scenario`, html: scenario }] : []),
        countQuestion(
          b.fine,
          `Out of ${fine} ${b.words.units}, in how many do you expect that {${b.calc.clause}}?`,
          true,
          // At least 1: they have just said it is not impossible (or not certain).
          { n: b.fineScale, min: 1, max: b.fineScale - 1 },
        ),
      ],
    },
  ];
}

/**
 * A follow-up for an answer of 0 only, with its own wording (the standalone
 * low-probability item). Same storage as boundaryPages: <prefix>_boundary_meaning
 * is "effectively_zero" or "very_rare", and "very_rare" asks for a count out
 * of the fine scale in <prefix>_boundary_fine. The original 0 is kept as given.
 */
export function zeroFollowUpPages(b, { title, question, choices, fineQuestion }) {
  const atZero = `{${b.source}} = 0`;
  return [
    {
      name: `${b.prefix}_boundary`,
      title,
      visibleIf: atZero,
      elements: [{
        type: 'radiogroup',
        name: b.meaning,
        title: question,
        isRequired: true,
        requiredErrorText: 'Choose one to continue.',
        choices: Object.entries(choices).map(([value, text]) => ({ value, text })),
      }],
    },
    {
      name: `${b.prefix}_boundary_scale`,
      title,
      visibleIf: `${atZero} and {${b.meaning}} = 'very_rare'`,
      // At least 1: they have just said some people do this.
      elements: [countQuestion(b.fine, fineQuestion, true, { n: b.fineScale, min: 1, max: b.fineScale - 1 })],
    },
  ];
}

/**
 * UPDATE AT 0 OR 100
 * The meaning question, with Update's own choices, then -- for "possible, but
 * very rare" / "failure is possible" -- ONE refinement out of b.fineScale
 * (1,000), of the rare event, as a whole number. It must still round to the
 * original answer: a count out of 1,000 that rounds to 0 out of 100 is 0-4
 * (5 is 0.5%, which rounds up). Anything else is refused with a pointer back to
 * the original answer, so contradictory estimates never go through. A refined
 * 0 is accepted: it means "below 0.5 in 1,000, but not impossible".
 */
export const UPDATE_BOUNDARY_CHOICES = {
  impossible: 'Success is impossible.',
  very_rare: 'Success is possible, but very rare.',
  certain: 'Success is certain.',
  not_certain: 'Failure is possible, but very rare.',
};
export function updateBoundaryPages(b, { title, recap, scenario }) {
  const maxConsistent = Math.ceil((b.fineScale / b.max) * 0.5) - 1;
  const atZero = `{${b.source}} = 0`;
  const atMax = `{${b.source}} = ${b.max}`;
  return [
    {
      name: `${b.prefix}_boundary`,
      title,
      visibleIf: atBoundary(b),
      elements: [
        card(`${b.prefix}_boundary_recap`, recap),
        {
          type: 'radiogroup',
          name: b.meaning,
          title: `{${b.calc.question}}`,
          isRequired: true,
          requiredErrorText: 'Choose one to continue.',
          choices: Object.entries(UPDATE_BOUNDARY_CHOICES).map(([value, text]) => ({
            value, text, visibleIf: value === 'impossible' || value === 'very_rare' ? atZero : atMax })),
        },
      ],
    },
    {
      name: `${b.prefix}_boundary_scale`,
      title,
      visibleIf: fineChosen(b),
      elements: [
        { ...card(`${b.prefix}_boundary_refine_low`, `<p>You indicated that success is possible, but your expected
          number rounds to 0 out of 100.</p>`), visibleIf: atZero },
        { ...card(`${b.prefix}_boundary_refine_high`, `<p>You indicated that failure is possible, but your expected
          number rounds to 100 successes out of 100.</p>`), visibleIf: atMax },
        ...(scenario ? [{ type: 'html', name: `${b.prefix}_boundary_scenario`, html: scenario }] : []),
        // The input accepts 0-1,000 so that an inconsistent count reaches the
        // rounding check in app.js, which explains it (words.mismatch).
        { ...countQuestion(b.fine, `{${b.calc.refine}}`, true, { n: b.fineScale }),
          description: `Enter a whole number from 0 to ${maxConsistent}.` },
      ],
    },
  ];
}

/* ---------- A single numeric question ---------- */

/** Scenario card, then one number. Used for the diagnostics and the repeat. */
export function numericItemPage({ name, title, html, field, question, min = 0, max = 100, integer = true }) {
  return {
    name,
    title,
    elements: [
      ...(html ? [card(`${name}_text`, html)] : []),
      countQuestion(field, question, integer, { n: max, min, max }),
    ],
  };
}

export const finalCommentsPage = {
  name: 'final_comments',
  title: 'Final comments',
  elements: [
    {
      type: 'comment',
      name: 'final_comments',
      title: 'Is there anything else you would like to tell us about this exercise?',
      description: 'For example, anything that was confusing, or how the survey could be improved. Please do not include anything that identifies you.',
      placeholder: 'Optional',
      rows: 5,
    },
  ],
};

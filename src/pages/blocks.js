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

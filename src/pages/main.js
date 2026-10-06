import { updatePage, fitCheckPage, countQuestion, card } from "./training.js";
import { SHARED_CONTEXT } from "../questions.js";
import { RARE_N } from "../stats.js";

/**
 * The main survey: every question in `items` (already in the order this
 * respondent should see them).
 *
 * Page and field names come from each question's id, never its position, so
 * the random order changes only what is shown -- not where the data lands.
 * Titles carry the display position ("Question 3 of 6"), which is all the
 * respondent needs.
 */
export function buildMainPages(items) {
  return [
    sharedContextPage(items.length),
    ...items.flatMap((item, i) => questionPages(item, i + 1, items.length).map(withContextReminder)),
  ];
}

// The shared context in full, once, before the first question.
function sharedContextPage(total) {
  return {
    name: "shared_context",
    title: `Before the questions\nShared context`,
    elements: [
      {
        type: "html",
        name: "shared_context_text",
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
        type: "html",
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

function questionPages(item, position, total) {
  const id = item.prefix;
  const heading = (name) => `Question ${position} of ${total}\n${name}`;
  return [
    {
      name: `${id}_estimate`,
      title: heading("Initial estimate"),
      elements: [
        { type: "html", name: `${id}_scenario`, html: item.question.scenario },
        countQuestion(
          item.prior,
          "Imagine 100 comparable attempts under these conditions. In how many would you expect the agent to succeed?",
          true,
        ),
      ],
    },
    boundaryPage(item, heading("Initial estimate")),
    ...item.updates.map((_, i) => ({
      ...updatePage(item, i, `${id}_update${i ? `_${i + 1}` : ""}`, heading(`Hypothetical update ${i + 1} of 3`)),
      visibleIf: notAtBoundary(item),
    })),
    fitCheckPage(item, `${id}_fit_check`, heading("Your fitted distribution")),
    ...rarePages(item, heading),
    reflectionPage(item, heading("About this question")),
  ];
}

/**
 * AN INITIAL ESTIMATE OF 0 OR 100
 * -------------------------------
 * No distribution can be fitted at either end, so instead of the usual three
 * updates the respondent is asked what they meant. "Impossible" goes straight
 * on to "About this question". "Merely very rare" repeats the format -- an
 * estimate, three hypothetical results and the fitted distribution -- out of
 * RARE_N attempts, counting the rare outcome: successes after 0, failures
 * after 100. The wording comes from survey variables set in app.js.
 */
const atBoundary = (item) => `({${item.prior}} = 0 or {${item.prior}} = 100)`;
// A skipped estimate (possible while requireAnswers is off) keeps the usual updates.
const notAtBoundary = (item) => `({${item.prior}} empty or ({${item.prior}} > 0 and {${item.prior}} < 100))`;
const rareChosen = (item) => `${atBoundary(item)} and {${item.boundaryMeaning}} = 'very_rare'`;

function boundaryPage(item, title) {
  return {
    name: `${item.prefix}_boundary`,
    title,
    visibleIf: atBoundary(item),
    elements: [
      card(`${item.prefix}_boundary_recap`,
        `<p>You estimated that the agent would succeed in <strong>{${item.prior}} of 100</strong> comparable attempts.</p>`),
      {
        type: "radiogroup",
        name: item.boundaryMeaning,
        title: `Do you mean that you think {${item.rare.vars.subject}} is impossible, or merely very rare?`,
        isRequired: true,
        requiredErrorText: "Choose one to continue.",
        choices: [
          { value: "impossible", text: "Impossible" },
          { value: "very_rare", text: "Merely very rare" },
        ],
      },
    ],
  };
}

function rarePages(item, heading) {
  const { rare } = item;
  const id = item.prefix;
  const scale = RARE_N.toLocaleString("en-US");
  return [
    {
      name: `${id}_rare_estimate`,
      title: heading("Initial estimate, on a finer scale"),
      visibleIf: rareChosen(item),
      elements: [
        card(`${id}_rare_intro`,
          `<p>To tell "very rare" apart from "never", the rest of this question uses a finer scale:
          <strong>${scale}</strong> comparable attempts instead of 100. The hypothetical results that follow
          use the same scale.</p>`),
        { type: "html", name: `${id}_rare_scenario`, html: item.question.scenario },
        countQuestion(
          rare.prior,
          `Imagine ${scale} comparable attempts under these conditions. In how many would you expect the agent to {${rare.vars.verb}}?`,
          true,
          // At least 1: they have just said it is not impossible.
          { n: RARE_N, min: 1, max: RARE_N - 1 },
        ),
      ],
    },
    ...rare.updates.map((_, i) => ({
      ...updatePage(rare, i, `${id}_rare_update${i ? `_${i + 1}` : ""}`, heading(`Hypothetical update ${i + 1} of 3`)),
      visibleIf: rareChosen(item),
    })),
    {
      ...fitCheckPage(rare, `${id}_rare_fit_check`, heading("Your fitted distribution")),
      visibleIf: `${rareChosen(item)} and {${rare.fitValid}} = true`,
    },
  ];
}

function reflectionPage(item, title) {
  return {
    // Deliberately has no visibleIf, so boundary answers (0 or 100), which
    // skip the fitted-distribution page, still reach this question.
    name: `${item.prefix}_reflection`,
    title,
    elements: [
      // Uncertainty-source questions: struck for now; uncomment to restore.
      // Their columns (uncertainty_source, _other, _reducible) stay defined in
      // items.js, so restoring them puts answers back in the same place.
      // {
      //   type: "radiogroup",
      //   name: item.uncertaintySource,
      //   title: "What is the main source of your uncertainty?",
      //   choices: [...item.question.uncertaintySources, { value: "other", text: "Something else" }],
      // },
      // {
      //   type: "comment",
      //   name: item.uncertaintySourceOther,
      //   title: "What is it?",
      //   visibleIf: `{${item.uncertaintySource}} = 'other'`,
      //   requiredIf: `{${item.uncertaintySource}} = 'other'`,
      //   description: "Please do not include anything that identifies you.",
      //   placeholder: "Briefly describe the main thing you are unsure about…",
      //   rows: 3,
      // },
      // {
      //   // The reducible/irreducible split is what tells you whether a wide
      //   // interval would narrow with more evidence or is genuine variance.
      //   type: "radiogroup",
      //   name: item.uncertaintyReducible,
      //   title: "Would more evidence narrow this, or is it inherent variability?",
      //   choices: [
      //     { value: "reducible", text: "More evidence would narrow it" },
      //     { value: "inherent", text: "Mostly inherent run-to-run variability" },
      //     { value: "mixed", text: "A mix of both" },
      //   ],
      // },
      {
        // Asked about every main question, not the training: a low score
        // flags a scenario to rewrite before it is used at scale.
        type: "radiogroup",
        name: item.clarityRating,
        title: "How easy was it to understand what this question was asking you to provide?",
        isRequired: true,
        requiredErrorText: "Choose one to continue.",
        choices: [
          { value: 1, text: "1 = Very difficult to understand" },
          { value: 2, text: "2 = Difficult" },
          { value: 3, text: "3 = Neither difficult nor easy" },
          { value: 4, text: "4 = Easy" },
          { value: 5, text: "5 = Very easy" },
        ],
      },
      {
        // Optional: a required free-text box mostly collects "n/a". Answers
        // here are about the question, not the agent, so they show where a
        // scenario is underspecified before it is used at scale.
        type: "comment",
        name: item.missingInfo,
        title: "What would have helped you answer this question better?",
        description:
          "For example, information you felt was missing, or anything that was unclear. If you like, restate the question, or any part of it, in your own words, the way you would rather have been asked. Please do not include anything that identifies you.",
        placeholder: "Optional",
        rows: 4,
      },
    ],
  };
}

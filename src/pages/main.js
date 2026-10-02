import { updatePage, fitCheckPage, countQuestion } from "./training.js";
import { SHARED_CONTEXT } from "../questions.js";

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
    ...item.updates.map((_, i) =>
      updatePage(item, i, `${id}_update${i ? `_${i + 1}` : ""}`, heading(`Hypothetical update ${i + 1} of 3`)),
    ),
    fitCheckPage(item, `${id}_fit_check`, heading("Your fitted distribution")),
    reflectionPage(item, heading("Source of uncertainty")),
  ];
}

function reflectionPage(item, title) {
  return {
    // Deliberately has no visibleIf, so boundary answers (0 or 100), which
    // skip the fitted-distribution page, still reach this question.
    name: `${item.prefix}_reflection`,
    title,
    elements: [
      {
        type: "radiogroup",
        name: item.uncertaintySource,
        title: "What is the main source of your uncertainty?",
        choices: [...item.question.uncertaintySources, { value: "other", text: "Something else" }],
      },
      {
        type: "comment",
        name: item.uncertaintySourceOther,
        title: "What is it?",
        visibleIf: `{${item.uncertaintySource}} = 'other'`,
        requiredIf: `{${item.uncertaintySource}} = 'other'`,
        description: "Please do not include anything that identifies you.",
        placeholder: "Briefly describe the main thing you are unsure about…",
        rows: 3,
      },
      {
        // The reducible/irreducible split is what tells you whether a wide
        // interval would narrow with more evidence or is genuine variance.
        type: "radiogroup",
        name: item.uncertaintyReducible,
        title: "Would more evidence narrow this, or is it inherent variability?",
        choices: [
          { value: "reducible", text: "More evidence would narrow it" },
          { value: "inherent", text: "Mostly inherent run-to-run variability" },
          { value: "mixed", text: "A mix of both" },
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

import { MAIN_ITEM } from "../items.js";
import { updatePage } from "./training.js";
/**
 * The elicitation item itself, plus the reflection and follow-up pages.
 * Field names here are load-bearing: the collector sheet already has these
 * columns, so renaming one splits existing responses across two headers.
 */
export const mainPages = [
      {
        name: "baseline",
        title: "Expert judgment · Initial estimate",
        elements: [
          {
            type: "html",
            name: "scenario",
            html: `
              <section class="scenario-card" aria-label="Scenario conditions">
                <span class="scenario-eyebrow">Scenario</span>
                <p>Consider a state-of-the-art AI agent that can use the internet and make phone calls. Its task is to call a restaurant and make a reservation for two people at 7 pm on a specified date.</p>
                <ul>
                  <li>The correct restaurant phone number is provided.</li>
                  <li>The restaurant has availability and accepts phone reservations.</li>
                  <li>Success means the correct name, date, time, and party size are booked.</li>
                </ul>
              </section>`,
          },
          {
            type: "text",
            name: "prior_successes",
            title:
              "Imagine 100 comparable attempts under these conditions. In how many would you expect the agent to succeed?",
            description: "Enter a whole number from 0 to 100.",
            inputType: "number",
            min: 0,
            max: 100,
            step: 1,
            isRequired: true,
            requiredErrorText: "Enter your estimate before continuing.",
            validators: [
              {
                type: "numeric",
                minValue: 0,
                maxValue: 100,
                text: "Enter a whole number from 0 to 100.",
              },
            ],
          },
        ],
      },
      ...MAIN_ITEM.updates.map((_, i) => updatePage(MAIN_ITEM, i, `evidence${i ? `_${i + 1}` : ""}`, `Expert judgment · Hypothetical update ${i + 1} of 3`)),
      {
        // Deliberately has no visibleIf, so boundary answers (0 or 100), which
        // skip the sanity page entirely, still reach this question.
        name: "reflection",
        title: "Expert judgment · Source of uncertainty",
        elements: [
          {
            type: "radiogroup",
            name: "uncertainty_source",
            title: "What is the main source of your uncertainty?",
            choices: [
              {
                value: "model_capability",
                text: "How capable current models are at multi-step tool use and real-time voice",
              },
              {
                value: "agent_engineering",
                text: "How well this particular agent is engineered — retries, error recovery, prompting",
              },
              {
                value: "no_evidence",
                text: "I have not seen relevant benchmarks or deployment data to anchor on",
              },
              {
                value: "restaurant_variation",
                text: "Variation between restaurants — staff, background noise, hold times, accents",
              },
              {
                value: "success_definition",
                text: "What counts as success — partial bookings, right table at the wrong time, no confirmation",
              },
              { value: "other", text: "Something else" },
            ],
          },
          {
            type: "comment",
            name: "uncertainty_source_other",
            title: "What is it?",
            visibleIf: "{uncertainty_source} = 'other'",
            requiredIf: "{uncertainty_source} = 'other'",
            placeholder: "Briefly describe the main thing you are unsure about…",
            rows: 3,
          },
          {
            // The reducible/irreducible split is what tells you whether a wide
            // interval would narrow with more evidence or is genuine variance.
            type: "radiogroup",
            name: "uncertainty_reducible",
            title: "Would more evidence narrow this, or is it inherent variability?",
            choices: [
              { value: "reducible", text: "More evidence would narrow it" },
              { value: "inherent", text: "Mostly inherent run-to-run variability" },
              { value: "mixed", text: "A mix of both" },
            ],
          },
        ],
      },
      {
        // Kept on its own page at the very end. Asking who someone is before
        // they estimate invites them to answer for the record rather than
        // honestly, and this page is reachable by every respondent -- including
        // those whose updated estimate skipped the sanity step.
        name: "follow_up",
        title: "Expert judgment · Follow-up",
        elements: [
          {
            type: "text",
            name: "participant_name",
            title: "What is your name?",
            description:
              "Recorded alongside your answers so we can follow up with you about this pilot.",
            isRequired: true,
            requiredErrorText: "Enter your name so we can follow up with you.",
          },
        ],
      },
];


/**
 * The elicitation item itself, plus the reflection and follow-up pages.
 * Field names here are load-bearing: the collector sheet already has these
 * columns, so renaming one splits existing responses across two headers.
 */
export const mainPages = [
      {
        name: "baseline",
        title: "Step 1 · Initial estimate",
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
      {
        name: "evidence",
        title: "Step 2 · Hypothetical evidence",
        elements: [
          {
            type: "html",
            name: "evidence_summary",
            visibleIf: "{prior_successes} > 0 and {prior_successes} < 100",
            html: `
              <section class="evidence-card" aria-label="Initial estimate and hypothetical evidence">
                <div class="evidence-grid">
                  <div class="evidence-stat">
                    <span>Your initial estimate</span>
                    <strong>{prior_successes} / 100</strong>
                  </div>
                  <div class="evidence-stat">
                    <span>Hypothetical eval result</span>
                    <strong>{generated_x} / 100</strong>
                  </div>
                </div>
                <p class="evidence-caption">This result is generated automatically to be moderately surprising relative to your first estimate.</p>
              </section>`,
          },
          {
            type: "text",
            name: "updated_successes",
            visibleIf: "{prior_successes} > 0 and {prior_successes} < 100",
            title:
              "After seeing those results, in how many of the next 100 comparable attempts would you expect the agent to succeed?",
            description:
              "Move your estimate toward the hypothetical evidence. Decimals are welcome.",
            inputType: "number",
            // Deliberately unconstrained. The pilot is measuring whether people
            // update coherently, so the field accepts anything numeric --
            // including values outside 0-100 and answers that ignore the stated
            // range. What they typed is recorded and classified, never blocked.
            // "any" step stops the browser rejecting arbitrary decimals.
            step: "any",
            isRequired: true,
            requiredErrorText: "Enter your updated estimate before continuing.",
          },
          {
            type: "html",
            name: "boundary_message",
            visibleIf: "{prior_successes} = 0 or {prior_successes} = 100",
            html: `
              <section class="boundary-card" role="note">
                <span class="scenario-eyebrow">Boundary estimate</span>
                <h3>No finite Beta fit is forced</h3>
                <p>You entered <strong>{prior_successes} out of 100</strong>. An exact 0% or 100% mean lies on the boundary of a standard Beta distribution, so this prototype does not generate a follow-up result or pretend that a finite Beta fit is available. Your initial response will still be recorded.</p>
              </section>`,
          },
        ],
      },
      {
        name: "sanity",
        title: "Step 3 · Sanity check",
        // Requires a fitted Beta. An updated estimate outside (s, x) has no
        // finite fit, so this page is skipped rather than shown broken -- and
        // skipping it silently avoids signalling that the answer was "wrong".
        visibleIf:
          "{prior_successes} > 0 and {prior_successes} < 100 and {fit_valid} = true",
        elements: [
          {
            type: "html",
            name: "beta_summary",
            html: `
              <div class="fit-shell" data-fit-host>
                <p>Calculating the implied uncertainty distribution…</p>
              </div>`,
          },
          {
            type: "radiogroup",
            name: "sanity_check",
            // The summary paragraph above already poses this question, so the
            // title would only ask it a second time.
            title: "Does this look like a reasonable representation of your uncertainty?",
            titleLocation: "hidden",
            isRequired: true,
            requiredErrorText: "Choose the option that best matches your judgement.",
            choices: [
              { value: "about_right", text: "About right" },
              { value: "too_narrow", text: "Too narrow — I am more uncertain" },
              { value: "too_wide", text: "Too wide — I am less uncertain" },
              {
                value: "something_else",
                text: "Something else — I interpreted the earlier questions differently",
              },
            ],
          },
          {
            type: "comment",
            name: "sanity_comment",
            title: "What seems different?",
            visibleIf: "{sanity_check} = 'something_else'",
            requiredIf: "{sanity_check} = 'something_else'",
            placeholder: "Briefly describe what you expected instead…",
            rows: 3,
          },
        ],
      },
      {
        // Deliberately has no visibleIf, so boundary answers (0 or 100), which
        // skip the sanity page entirely, still reach this question.
        name: "reflection",
        title: "Step 4 · Source of uncertainty",
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
        title: "Step 5 · Follow-up",
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

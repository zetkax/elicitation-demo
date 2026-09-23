/**
 * Training pages, shown before the elicitation item itself.
 *
 * Purpose: make the *instrument* unambiguous so that what varies between
 * respondents is domain intuition, not their reading of the questions.
 * Nothing here is about AI capability -- the practice scenarios are
 * deliberately from other domains, so practising the format plants no number
 * for the real question.
 */
export const trainingPages = [
      {
        name: "training_intro",
        title: "Before you start",
        elements: [
          {
            type: "html",
            name: "intro_text",
            html: `
              <section class="scenario-card" aria-label="About this exercise">
                <span class="scenario-eyebrow">What this is</span>
                <p>Thank you for taking part. This is a short expert elicitation
                exercise: we are asking a small number of people who know this area
                well what they expect an AI agent to be able to do, and &mdash; just
                as importantly &mdash; how sure they are about it.</p>
                <p>It takes about ten minutes. The first half is training, so that
                the questions themselves are unambiguous by the time you reach them.
                Nothing in the training is scored or recorded as an opinion.</p>
              </section>
              <section class="scenario-card" aria-label="Why your honest answer matters">
                <span class="scenario-eyebrow">Why we want your actual view</span>
                <p>There is no right answer here and nothing is being tested. We are
                measuring what informed people actually believe, so an answer chosen
                to look defensible is worse for us than one you would bet on.</p>
                <p>Your uncertainty is data in its own right, not a weakness in the
                answer. A wide range from someone who genuinely does not know is
                more useful than a confident number they do not hold, because we
                combine these responses and a false show of confidence pulls the
                result around more than it deserves to.</p>
                <p>You are also welcome to be the outlier. If your view differs from
                what you think colleagues would say, that disagreement is precisely
                what the exercise is for.</p>
              </section>`,
          },
        ],
      },
      {
        name: "training_structure",
        title: "How the questions work",
        elements: [
          {
            type: "html",
            name: "structure_text",
            html: `
              <section class="scenario-card" aria-label="Question structure">
                <span class="scenario-eyebrow">Three steps, every time</span>
                <p>Each question has the same shape:</p>
                <ul>
                  <li><strong>Your estimate.</strong> Out of 100 attempts under fixed
                  conditions, how many succeed? We ask for a count rather than a
                  percentage because most people reason more reliably about
                  "how many out of 100" than about probabilities.</li>
                  <li><strong>A hypothetical result.</strong> We show you a made-up
                  evaluation result, generated to be moderately surprising given what
                  you just said. It is not real data and is not a hint about the
                  answer.</li>
                  <li><strong>Your revised estimate.</strong> If you had seen that
                  result, what would you then expect?</li>
                </ul>
                <p>The third step is the one that carries most of the information, so
                it is worth being precise about what it asks.</p>
              </section>
              <section class="scenario-card" aria-label="What the update question means">
                <span class="scenario-eyebrow">The revised estimate</span>
                <p>We are <strong>not</strong> asking what the true rate is, nor for
                an average of the two numbers, nor whether you think the hypothetical
                result was correct.</p>
                <p>We are asking one thing: <strong>if you had seen that result, what
                would you now expect in the next 100 attempts?</strong></p>
                <p>How far you move is what tells us how firmly you held your first
                number:</p>
                <ul>
                  <li>Barely moving says the result did little to change your mind
                  &mdash; you had good reason for your estimate.</li>
                  <li>Moving most of the way says you held your first number
                  loosely and the result carried more weight than it did.</li>
                  <li>Moving a little of the way says something in between.</li>
                </ul>
                <p>None of these is the "correct" response. They describe different
                states of knowledge, and we want the one that is actually yours.</p>
                <p>One consequence worth noticing: a <em>more</em> surprising result
                should generally move you <em>further</em>. If a result of 55 would
                shift you a little, a result of 80 should shift you at least as much,
                in the same direction.</p>
              </section>`,
          },
          {
            type: "radiogroup",
            name: "training_check",
            title:
              "Suppose you estimate 40 out of 100, and the hypothetical result is 25 out of 100. Which revised answer says you hold your original estimate most firmly?",
            description: "This is a comprehension check, not an opinion. It is not recorded as a judgement.",
            isRequired: true,
            requiredErrorText: "Pick one to continue.",
            choices: [
              { value: "38", text: "38 out of 100" },
              { value: "32", text: "32 out of 100" },
              { value: "25", text: "25 out of 100" },
              { value: "18", text: "18 out of 100" },
            ],
          },
          {
            type: "html",
            name: "training_check_feedback",
            visibleIf: "{training_check} notempty",
            html: `
              <section class="scenario-card" role="note">
                <span class="scenario-eyebrow">Answer</span>
                <p><strong>38 out of 100.</strong> It is the answer closest to your own
                estimate, so it says the result barely moved you.</p>
                <p>32 says the result moved you about half way. 25 says you adopted the
                result entirely and your own view counted for nothing. 18 moves past the
                result altogether, which would mean the evidence told you something even
                more extreme than it said &mdash; almost never what people intend.</p>
              </section>`,
          },
        ],
      },
      {
        name: "training_interpretation",
        title: "How we read your answers",
        elements: [
          {
            type: "html",
            name: "interpretation_text",
            html: `
              <section class="scenario-card" aria-label="How answers are interpreted">
                <span class="scenario-eyebrow">From two numbers to a range</span>
                <p>Your estimate and how far you revised it are enough to draw a curve
                over the possible success rates: where you think the rate most likely
                sits, and how much room you are leaving around it.</p>
                <p>You never have to draw or reason about this curve. Answer the two
                questions in whatever way feels honest and it follows automatically.
                Below is what it looks like for one made-up respondent.</p>
              </section>`,
          },
          {
            type: "html",
            name: "interpretation_example",
            html: `<div class="fit-shell" data-example-fit><p>Drawing the worked example&hellip;</p></div>`,
          },
          {
            type: "html",
            name: "interpretation_maths",
            html: `
              <section class="scenario-card" aria-label="Optional detail">
                <details class="maths-detail">
                  <summary>Show the maths (entirely optional)</summary>
                  <p>Nothing below changes how you should answer, and the exercise does
                  not assume you have read it.</p>
                  <p>Your first estimate <em>s</em> out of 100 is treated as the mean of
                  a Beta distribution, so &micro; = <em>s</em>/100. The hypothetical
                  result <em>X</em> is chosen so that, if your estimate were exactly
                  right, a result at least that extreme would occur about 10% of the
                  time &mdash; surprising, but not absurd.</p>
                  <p>Your revised estimate &micro;&prime; fixes how much weight you gave
                  that result, which pins the concentration:</p>
                  <p><code>&nu; = (X &minus; 100&micro;&prime;) / (&micro;&prime; &minus; &micro;)</code>,
                  then <code>&alpha; = &micro;&nu;</code> and
                  <code>&beta; = (1 &minus; &micro;)&nu;</code>.</p>
                  <p>A small revision implies a large &nu; and a narrow curve; a large
                  revision implies a small &nu; and a wide one. The band shown is the
                  5th to 95th percentile of that Beta distribution.</p>
                  <p>This is why a revision outside the two numbers has no reading:
                  &nu; comes out negative or infinite, which is not a distribution.</p>
                </details>
              </section>`,
          },
        ],
      },
      {
        name: "practice1_estimate",
        title: "Practice 1 of 2 · Initial estimate",
        elements: [
          {
            type: "html",
            name: "practice1_scenario",
            html: `
              <section class="scenario-card" aria-label="Practice scenario">
                <span class="scenario-eyebrow">Practice scenario</span>
                <p>A commuter train on a busy suburban line is scheduled to arrive at
                08:14 on a weekday morning.</p>
                <ul>
                  <li>Success means arriving within five minutes of the scheduled time.</li>
                  <li>Ordinary weather, no planned engineering work.</li>
                  <li>Count each weekday morning as one attempt.</li>
                </ul>
                <p>Deliberately not about AI &mdash; these two rounds are for practising
                the format, and we would rather they did not put a number in your head
                before the real question.</p>
              </section>`,
          },
          {
            type: "text",
            name: "practice1_prior_successes",
            title:
              "Out of 100 such weekday mornings, on how many would you expect the train to arrive within five minutes of schedule?",
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
        name: "practice1_update",
        title: "Practice 1 of 2 · Revised estimate",
        visibleIf: "{practice1_prior_successes} > 0 and {practice1_prior_successes} < 100",
        elements: [
          {
            type: "html",
            name: "practice1_evidence",
            html: `
              <section class="evidence-card" aria-label="Practice estimate and hypothetical result">
                <div class="evidence-grid">
                  <div class="evidence-stat">
                    <span>Your estimate</span>
                    <strong>{practice1_prior_successes} / 100</strong>
                  </div>
                  <div class="evidence-stat">
                    <span>Hypothetical result</span>
                    <strong>{practice1_generated_x} / 100</strong>
                  </div>
                </div>
                <p class="evidence-caption">Made up, and generated to be moderately surprising given your estimate.</p>
              </section>`,
          },
          {
            type: "text",
            name: "practice1_updated_successes",
            title:
              "Having seen that result, on how many of the next 100 such mornings would you expect the train to be on time?",
            inputType: "number",
            step: "any",
            isRequired: true,
            requiredErrorText: "Enter your revised estimate before continuing.",
          },
        ],
      },
      {
        name: "practice1_feedback",
        title: "Practice 1 of 2 · What that said",
        visibleIf: "{practice1_prior_successes} > 0 and {practice1_prior_successes} < 100",
        elements: [
          {
            type: "html",
            name: "practice1_fit",
            html: `<div class="fit-shell" data-fit-host data-item="practice1"><p>Reading your answer&hellip;</p></div>`,
          },
        ],
      },
      {
        name: "practice2_estimate",
        title: "Practice 2 of 2 · Initial estimate",
        elements: [
          {
            type: "html",
            name: "practice2_scenario",
            html: `
              <section class="scenario-card" aria-label="Practice scenario">
                <span class="scenario-eyebrow">Practice scenario</span>
                <p>An adult who has not used the service before sits down to complete a
                standard online government form &mdash; renewing a passport, say.</p>
                <ul>
                  <li>Success means submitting it without help from another person and
                  without abandoning the attempt.</li>
                  <li>They have the documents they need to hand.</li>
                  <li>Count each such person as one attempt.</li>
                </ul>
              </section>`,
          },
          {
            type: "text",
            name: "practice2_prior_successes",
            title:
              "Out of 100 such people, how many would you expect to submit the form unaided?",
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
        name: "practice2_update",
        title: "Practice 2 of 2 · Revised estimate",
        visibleIf: "{practice2_prior_successes} > 0 and {practice2_prior_successes} < 100",
        elements: [
          {
            type: "html",
            name: "practice2_evidence",
            html: `
              <section class="evidence-card" aria-label="Practice estimate and hypothetical result">
                <div class="evidence-grid">
                  <div class="evidence-stat">
                    <span>Your estimate</span>
                    <strong>{practice2_prior_successes} / 100</strong>
                  </div>
                  <div class="evidence-stat">
                    <span>Hypothetical result</span>
                    <strong>{practice2_generated_x} / 100</strong>
                  </div>
                </div>
                <p class="evidence-caption">Made up, and generated to be moderately surprising given your estimate.</p>
              </section>`,
          },
          {
            type: "text",
            name: "practice2_updated_successes",
            title:
              "Having seen that result, how many of the next 100 such people would you expect to submit the form unaided?",
            inputType: "number",
            step: "any",
            isRequired: true,
            requiredErrorText: "Enter your revised estimate before continuing.",
          },
        ],
      },
      {
        name: "practice2_feedback",
        title: "Practice 2 of 2 · What that said",
        visibleIf: "{practice2_prior_successes} > 0 and {practice2_prior_successes} < 100",
        elements: [
          {
            type: "html",
            name: "practice2_fit",
            html: `<div class="fit-shell" data-fit-host data-item="practice2"><p>Reading your answer&hellip;</p></div>`,
          },
          {
            type: "html",
            name: "practice_closing",
            html: `
              <section class="scenario-card" aria-label="End of training">
                <span class="scenario-eyebrow">That is the whole format</span>
                <p>The real question follows, on a subject where your own knowledge is
                what we are after. There is no feedback from here on &mdash; not because
                answers stop mattering, but because showing you how an answer was read
                would change the next one.</p>
              </section>`,
          },
        ],
      },
];

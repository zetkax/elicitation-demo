(() => {
  "use strict";

  const N = 100;
  const TARGET_TAIL = 0.1;
  const NUMERIC_EPSILON = 1e-12;

  const CONFIG = window.ELICITATION_CONFIG || {};
  const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || "";
  const SURVEY_VERSION = CONFIG.surveyVersion || "unversioned";
  const SHOW_EXPECTED_RANGE = CONFIG.showExpectedRange !== false;
  const PENDING_KEY = "elicitation_pending_v1";
  const STARTED_AT = new Date().toISOString();

  /**
   * X-SELECTION RULE
   * ----------------
   * For s in 1..99, let mu=s/100 and K~Binomial(100, mu).
   * - mu < 0.5: choose X>s with P(K>=X) closest to 0.10.
   * - mu > 0.5: choose X<s with P(K<=X) closest to 0.10.
   * - mu = 0.5: the binomial is symmetric, so neither direction is implied by
   *   the estimate. Toss a fair coin instead of always revising downwards.
   * Iterating outwards from s and updating only on a strict improvement makes
   * an exact tie prefer the less-extreme X. The 0 and 100 cases return null.
   *
   * `forcedDirection` ("up" | "down") is for deterministic tests; production
   * callers omit it. The result is computed once per answer and persisted as
   * generated_x, so the coin toss stays stable for a given estimate.
   */
  function chooseHypotheticalX(rawS, forcedDirection) {
    const s = Number(rawS);

    if (!Number.isInteger(s) || s <= 0 || s >= N) {
      return null;
    }

    const mu = s / N;
    const direction =
      forcedDirection ||
      (mu < 0.5 ? "up" : mu > 0.5 ? "down" : Math.random() < 0.5 ? "up" : "down");
    const pmf = new Array(N + 1).fill(0);

    pmf[0] = Math.pow(1 - mu, N);
    for (let k = 0; k < N; k += 1) {
      pmf[k + 1] =
        pmf[k] * ((N - k) / (k + 1)) * (mu / (1 - mu));
    }

    // Normalisation guards against accumulated floating-point error.
    const total = pmf.reduce((sum, probability) => sum + probability, 0);
    for (let k = 0; k <= N; k += 1) {
      pmf[k] /= total;
    }

    let bestX = null;
    let bestDifference = Infinity;

    if (direction === "up") {
      const upperTail = new Array(N + 1);
      let tail = 0;

      for (let k = N; k >= 0; k -= 1) {
        tail += pmf[k];
        upperTail[k] = tail;
      }

      for (let x = s + 1; x <= N; x += 1) {
        const difference = Math.abs(upperTail[x] - TARGET_TAIL);
        if (difference < bestDifference - Number.EPSILON) {
          bestDifference = difference;
          bestX = x;
        }
      }
    } else {
      const lowerTail = new Array(N + 1);
      let tail = 0;

      for (let k = 0; k <= N; k += 1) {
        tail += pmf[k];
        lowerTail[k] = tail;
      }

      for (let x = s - 1; x >= 0; x -= 1) {
        const difference = Math.abs(lowerTail[x] - TARGET_TAIL);
        if (difference < bestDifference - Number.EPSILON) {
          bestDifference = difference;
          bestX = x;
        }
      }
    }

    return bestX;
  }

  /**
   * BETA FIT
   * --------
   * The updated estimate is converted to mu'=updated_successes/100, then:
   *   nu    = (X - N*mu') / (mu' - mu)
   *   alpha = mu*nu
   *   beta  = (1-mu)*nu
   * The strict-between check is essential: without it, nu cannot represent a
   * positive, finite Beta concentration.
   */
  function calculateBetaFit(rawS, rawX, rawUpdated) {
    const s = Number(rawS);
    const x = Number(rawX);
    const updated = Number(rawUpdated);

    if (![s, x, updated].every(Number.isFinite)) {
      return { valid: false, reason: "Enter a finite numeric updated estimate." };
    }

    const mu = s / N;
    const evidenceRate = x / N;
    const muPrime = updated / N;
    const lower = Math.min(mu, evidenceRate);
    const upper = Math.max(mu, evidenceRate);

    if (!(muPrime > lower + NUMERIC_EPSILON && muPrime < upper - NUMERIC_EPSILON)) {
      return {
        valid: false,
        reason: `Your updated estimate must be strictly between ${formatCount(
          Math.min(s, x),
        )} and ${formatCount(Math.max(s, x))} successes out of 100.`,
      };
    }

    const denominator = muPrime - mu;
    const nu = (x - N * muPrime) / denominator;
    const alpha = mu * nu;
    const beta = (1 - mu) * nu;

    if (
      !Number.isFinite(nu) ||
      nu <= 0 ||
      !Number.isFinite(alpha) ||
      alpha <= 0 ||
      !Number.isFinite(beta) ||
      beta <= 0
    ) {
      return {
        valid: false,
        reason:
          "These answers do not imply a positive, finite Beta distribution. Please adjust the updated estimate.",
      };
    }

    return {
      valid: true,
      mu,
      muPrime,
      evidenceRate,
      nu,
      alpha,
      beta,
    };
  }

  // Lanczos log-gamma approximation used by the Beta density and CDF.
  function logGamma(z) {
    const coefficients = [
      676.5203681218851,
      -1259.1392167224028,
      771.3234287776531,
      -176.6150291621406,
      12.507343278686905,
      -0.13857109526572012,
      9.984369578019572e-6,
      1.5056327351493116e-7,
    ];

    if (z < 0.5) {
      return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    }

    let adjusted = z - 1;
    let series = 0.9999999999998099;
    for (let index = 0; index < coefficients.length; index += 1) {
      series += coefficients[index] / (adjusted + index + 1);
    }

    const t = adjusted + coefficients.length - 0.5;
    return (
      0.5 * Math.log(2 * Math.PI) +
      (adjusted + 0.5) * Math.log(t) -
      t +
      Math.log(series)
    );
  }

  function betaContinuedFraction(a, b, x) {
    const maxIterations = 200;
    const fpMin = 1e-300;
    const convergence = 3e-12;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;

    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < fpMin) d = fpMin;
    d = 1 / d;
    let result = d;

    for (let m = 1; m <= maxIterations; m += 1) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));

      d = 1 + aa * d;
      if (Math.abs(d) < fpMin) d = fpMin;
      c = 1 + aa / c;
      if (Math.abs(c) < fpMin) c = fpMin;
      d = 1 / d;
      result *= d * c;

      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < fpMin) d = fpMin;
      c = 1 + aa / c;
      if (Math.abs(c) < fpMin) c = fpMin;
      d = 1 / d;
      const delta = d * c;
      result *= delta;

      if (Math.abs(delta - 1) < convergence) break;
    }

    return result;
  }

  function regularizedIncompleteBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    const front = Math.exp(
      logGamma(a + b) -
        logGamma(a) -
        logGamma(b) +
        a * Math.log(x) +
        b * Math.log1p(-x),
    );

    if (x < (a + 1) / (a + b + 2)) {
      return (front * betaContinuedFraction(a, b, x)) / a;
    }

    return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
  }

  function betaQuantile(probability, alpha, beta) {
    if (probability <= 0) return 0;
    if (probability >= 1) return 1;

    let lower = 0;
    let upper = 1;

    for (let iteration = 0; iteration < 90; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      if (regularizedIncompleteBeta(midpoint, alpha, beta) < probability) {
        lower = midpoint;
      } else {
        upper = midpoint;
      }
    }

    return (lower + upper) / 2;
  }

  function betaDensity(x, alpha, beta) {
    const boundedX = Math.min(1 - 1e-7, Math.max(1e-7, x));
    const logBeta = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
    const logDensity =
      (alpha - 1) * Math.log(boundedX) +
      (beta - 1) * Math.log1p(-boundedX) -
      logBeta;
    return Math.exp(Math.min(logDensity, 700));
  }

  function formatCount(value) {
    return Number.isInteger(Number(value))
      ? String(Number(value))
      : Number(value).toFixed(1).replace(/\.0$/, "");
  }

  function formatPercent(value, digits = 1) {
    return `${(value * 100).toFixed(digits).replace(/\.0$/, "")}%`;
  }

  // Exposing the pure math helpers makes the prototype easy to test in isolation.
  globalThis.ElicitationMath = Object.freeze({
    chooseHypotheticalX,
    calculateBetaFit,
    betaQuantile,
    regularizedIncompleteBeta,
  });

  // Stop here when this file is loaded by a command-line math test.
  if (typeof Survey === "undefined" || typeof document === "undefined") return;

  const surveyJson = {
    title: "How capable are SOTA AI agents at making restaurant reservations?",
    description:
      "Please answer the following questions accurately and honestly. There are no wrong or right answers",
    showQuestionNumbers: "off",
    showProgressBar: false,
    showPrevButton: false,
    showPreviewBeforeComplete: "noPreview",
    pageNextText: "Continue",
    completeText: "Finish",
    questionErrorLocation: "bottom",
    checkErrorsMode: "onNextPage",
    clearInvisibleValues: "none",
    completedHtml:
      "<h3>Response recorded</h3><p>Thank you for taking part in this pilot.</p>",
    pages: [
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
    ],
  };

  const survey = new Survey.Model(surveyJson);

  function isBoundaryValue(value) {
    const numeric = Number(value);
    return numeric === 0 || numeric === N;
  }

  /**
   * ITEM REGISTRY
   * -------------
   * One elicitation item is three linked answers (prior, generated evidence,
   * updated estimate) plus the columns derived from them. The training rounds
   * are the same item run twice more, so the machinery is keyed by prefix
   * rather than duplicated. The real item keeps its original unprefixed field
   * names -- the collector sheet already has those columns, and renaming them
   * would split every existing response across two sets of headers.
   */
  function makeItem(prefix) {
    const key = (base) => (prefix ? `${prefix}_${base}` : base);
    return {
      prefix,
      isPractice: Boolean(prefix),
      prior: key("prior_successes"),
      generatedX: key("generated_x"),
      updated: key("updated_successes"),
      fitValid: key("fit_valid"),
      fitNu: key("fit_nu"),
      fitAlpha: key("fit_alpha"),
      fitBeta: key("fit_beta"),
      interval: key("credible_interval_90"),
      classification: key("update_classification"),
      outOfRange: key("updated_out_of_0_100"),
      invalidReason: key("fit_invalid_reason"),
    };
  }

  // The worked example on the training page. 47 is what the generator actually
  // returns for an estimate of 40, so the example is the real mechanism rather
  // than an illustration of it.
  const EXAMPLE = { prior: 40, evidence: 47, updated: 43 };
  const EXAMPLE_ITEM = { isExample: true, isPractice: false };

  const MAIN_ITEM = makeItem("");
  const PRACTICE_ITEMS = [makeItem("practice1"), makeItem("practice2")];
  const ALL_ITEMS = [...PRACTICE_ITEMS, MAIN_ITEM];
  const ITEM_BY_PREFIX = new Map(ALL_ITEMS.map((item) => [item.prefix, item]));

  function syncGeneratedX(item) {
    const rawS = survey.getValue(item.prior);
    const s = Number(rawS);
    const x = chooseHypotheticalX(s);

    if (x === null) {
      if (isBoundaryValue(s)) {
        survey.setValue(item.generatedX, "not_applicable_boundary_case");
      } else {
        survey.clearValue(item.generatedX);
      }
      return;
    }

    survey.setValue(item.generatedX, x);

    const updatedQuestion = survey.getQuestionByName(item.updated);
    if (updatedQuestion) {
      const low = Math.min(s, x);
      const high = Math.max(s, x);

      // No min/max is applied. Stating the range while leaving the field open
      // is what makes non-compliance interpretable: an out-of-range answer is
      // someone disregarding an instruction they were given, not someone who
      // was never told. Turn SHOW_EXPECTED_RANGE off to test the other design,
      // where nothing is stated and coherent updating has to be spontaneous.
      updatedQuestion.description = SHOW_EXPECTED_RANGE
        ? `Your answer should fall between ${low} and ${high}. Decimals are welcome.`
        : "Decimals are welcome.";
    }
  }

  /**
   * UPDATE CLASSIFICATION
   * ---------------------
   * Records how the updated estimate relates to the prior (s) and the
   * hypothetical evidence (x) so incoherent answers are countable rather than
   * merely absent. Coherent Bayesian updating lands strictly between the two.
   */
  function classifyUpdate(s, x, updated) {
    if (![s, x, updated].every(Number.isFinite)) return "not_applicable";
    if (updated === s) return "no_change";
    if (updated === x) return "matched_evidence";

    const towardEvidence = Math.sign(x - s);
    const actualMove = Math.sign(updated - s);

    if (actualMove !== towardEvidence) return "away_from_evidence";

    return Math.abs(updated - s) > Math.abs(x - s)
      ? "overshoot_past_evidence"
      : "toward_evidence";
  }

  /**
   * Recomputes the derived columns after any answer that feeds the Beta fit.
   * Only writes keys other than prior_successes/updated_successes, so the
   * onValueChanged listener that calls this cannot re-enter.
   */
  function refreshFitState(item) {
    const s = Number(survey.getValue(item.prior));
    const x = Number(survey.getValue(item.generatedX));
    const updated = Number(survey.getValue(item.updated));
    const fit = getFit(item);

    survey.setValue(item.fitValid, fit.valid);
    survey.setValue(item.classification, classifyUpdate(s, x, updated));
    survey.setValue(
      item.outOfRange,
      Number.isFinite(updated) ? updated < 0 || updated > N : false,
    );

    if (fit.valid) {
      survey.clearValue(item.invalidReason);
      saveDerivedFit(item, fit);
      return;
    }

    // Clear any fit from a previous, valid answer so a stale alpha/beta never
    // travels with an answer it does not describe.
    survey.setValue(item.invalidReason, fit.reason || "");
    survey.clearValue(item.fitNu);
    survey.clearValue(item.fitAlpha);
    survey.clearValue(item.fitBeta);
    survey.clearValue(item.interval);
  }

  function getFit(item) {
    return calculateBetaFit(
      survey.getValue(item.prior),
      survey.getValue(item.generatedX),
      survey.getValue(item.updated),
    );
  }

  function saveDerivedFit(item, fit) {
    if (!fit.valid) return;

    const interval = [
      betaQuantile(0.05, fit.alpha, fit.beta),
      betaQuantile(0.95, fit.alpha, fit.beta),
    ];

    survey.setValue(item.fitNu, fit.nu);
    survey.setValue(item.fitAlpha, fit.alpha);
    survey.setValue(item.fitBeta, fit.beta);
    survey.setValue(item.interval, interval);
  }

  survey.onValueChanged.add((sender, options) => {
    const priorOf = ALL_ITEMS.find((i) => i.prior === options.name);
    if (priorOf) {
      syncGeneratedX(priorOf);
      sender.clearValue(priorOf.updated);
      if (!priorOf.isPractice) {
        sender.clearValue("sanity_check");
        sender.clearValue("sanity_comment");
      }
    }

    const touched =
      priorOf || ALL_ITEMS.find((i) => i.updated === options.name);
    if (touched) refreshFitState(touched);
  });

  survey.onValidateQuestion.add((sender, options) => {
    if (ALL_ITEMS.some((i) => i.prior === options.question.name)) {
      const value = Number(options.value);
      if (Number.isFinite(value) && !Number.isInteger(value)) {
        options.error = "Use a whole number for the initial estimate.";
      }
    }

    // updated_successes is intentionally not validated. An answer outside the
    // stated range is data about the respondent, so it is recorded rather than
    // rejected, and the respondent gets no feedback that would coach them.
  });

  // Which item each page finishes, so leaving the page recomputes that item
  // and only that one.
  const PRIOR_PAGE_ITEM = {
    baseline: MAIN_ITEM,
    practice1_estimate: PRACTICE_ITEMS[0],
    practice2_estimate: PRACTICE_ITEMS[1],
  };
  const UPDATE_PAGE_ITEM = {
    evidence: MAIN_ITEM,
    practice1_update: PRACTICE_ITEMS[0],
    practice2_update: PRACTICE_ITEMS[1],
  };

  survey.onCurrentPageChanging.add((sender, options) => {
    const leaving = options.oldCurrentPage?.name;

    if (PRIOR_PAGE_ITEM[leaving]) {
      syncGeneratedX(PRIOR_PAGE_ITEM[leaving]);
    }

    if (UPDATE_PAGE_ITEM[leaving]) {
      // Never blocks. An answer that admits no Beta fit simply leaves the
      // sanity page hidden (see its visibleIf) and the respondent continues.
      refreshFitState(UPDATE_PAGE_ITEM[leaving]);
    }
  });

  survey.onAfterRenderQuestion.add((sender, options) => {
    const root = options.htmlElement;

    // The worked example on the training page is fixed, not the respondent's
    // own answer -- it has to be readable before they have given one.
    const exampleHost = root.querySelector("[data-example-fit]");
    if (exampleHost) {
      const fit = calculateBetaFit(EXAMPLE.prior, EXAMPLE.evidence, EXAMPLE.updated);
      if (fit.valid) {
        requestAnimationFrame(() => renderFitSummary(exampleHost, fit, EXAMPLE_ITEM));
      }
      return;
    }

    const host = root.querySelector("[data-fit-host]");
    if (!host) return;

    const item = ITEM_BY_PREFIX.get(host.dataset.item || "") || MAIN_ITEM;
    const fit = getFit(item);

    // Practice rounds explain what went wrong; the real item deliberately does
    // not, so that no feedback can shape the answer being measured.
    if (!fit.valid) {
      host.innerHTML = item.isPractice
        ? practiceMissHtml(item)
        : `<p class="fit-error">${fit.reason}</p>`;
      return;
    }

    requestAnimationFrame(() => renderFitSummary(host, fit, item));
  });

  /**
   * PERSISTENCE
   * -----------
   * Responses are POSTed to an Apps Script Web App that appends them to a
   * Google Sheet (see apps-script/README.md). A failed or unconfigured send
   * is never silent data loss: the payload goes to localStorage and is
   * retried the next time the page loads.
   */

  function makeResponseId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `r-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  // A spreadsheet cell cannot hold an array or object, so anything non-scalar
  // is stored as JSON rather than stringifying to "[object Object]".
  // Free-text answers are trimmed: a stray space makes a name look like a
  // different person when you sort or match the follow-up list.
  function flattenValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string") return value.trim();
    return value;
  }

  function buildPayload(data) {
    const submittedAt = new Date();
    const payload = {
      response_id: makeResponseId(),
      submitted_at: submittedAt.toISOString(),
      started_at: STARTED_AT,
      duration_seconds: Math.round(
        (submittedAt.getTime() - new Date(STARTED_AT).getTime()) / 1000,
      ),
      survey_version: SURVEY_VERSION,
      user_agent: navigator.userAgent,
    };

    Object.keys(data).forEach((key) => {
      if (key === "credible_interval_90") return;
      payload[key] = flattenValue(data[key]);
    });

    // The 90% interval is the headline output, so it gets its own two columns
    // instead of arriving as a JSON string nobody can chart.
    const interval = data.credible_interval_90;
    if (Array.isArray(interval) && interval.length === 2) {
      payload.ci90_low = interval[0];
      payload.ci90_high = interval[1];
    }

    return payload;
  }

  async function postResponse(payload) {
    // text/plain keeps this a CORS "simple request". Apps Script web apps do
    // not answer the preflight that application/json would trigger.
    const response = await fetch(RESULTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Collector returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || "Collector rejected the response.");
    }

    return result;
  }

  function readPending() {
    try {
      const stored = JSON.parse(localStorage.getItem(PENDING_KEY));
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      return [];
    }
  }

  function writePending(items) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(items));
    } catch (error) {
      console.warn("Could not write the pending-response backup.", error);
    }
  }

  // Keyed on response_id so a retried save replaces its earlier attempt
  // instead of stacking duplicates in the buffer.
  function queuePending(payload) {
    const items = readPending().filter(
      (item) => item.response_id !== payload.response_id,
    );
    items.push(payload);
    writePending(items);
  }

  function dropPending(responseId) {
    const items = readPending();
    const remaining = items.filter((item) => item.response_id !== responseId);
    if (remaining.length !== items.length) writePending(remaining);
  }

  async function flushPending() {
    if (!RESULTS_ENDPOINT) return;

    const items = readPending();
    if (!items.length) return;

    const stillPending = [];
    for (const item of items) {
      try {
        await postResponse(item);
      } catch (error) {
        stillPending.push(item);
      }
    }

    writePending(stillPending);

    const sent = items.length - stillPending.length;
    if (sent > 0) {
      console.log(`Recovered and sent ${sent} pending response(s).`);
    }
  }

  // Built once and reused, so the "Try again" button on a failed save cannot
  // mint a second response_id and land the same respondent in the sheet twice.
  let completionPayload = null;

  survey.onComplete.add((sender, options) => {
    // All requested raw values live in sender.data. Boundary cases keep
    // generated_x as a clear not-applicable marker and do not invent Q2 or
    // sanity-check answers that were never requested.
    completionPayload = completionPayload || buildPayload(sender.data);
    const payload = completionPayload;
    console.log("Expert elicitation response:", payload);

    if (!RESULTS_ENDPOINT) {
      // A missing endpoint is our misconfiguration, not something the
      // respondent did or can fix. Showing them a red error would be alarming
      // and pointless, so this is surfaced to the console instead.
      queuePending(payload);
      console.warn(
        "No resultsEndpoint configured — response held in localStorage only. See apps-script/README.md.",
      );
      // No save banner at all. Claiming success here would hide the fact that
      // nothing was transmitted, and a red error would alarm a respondent who
      // cannot do anything about it. The response is buffered and will flush
      // once an endpoint exists, so silence is honest rather than lossy.
      return;
    }

    options.showSaveInProgress?.("Saving your response…");

    postResponse(payload)
      .then(() => {
        dropPending(payload.response_id);
        options.showSaveSuccess?.("Response saved. Thank you.");
      })
      .catch((error) => {
        console.error("Could not save the response.", error);
        queuePending(payload);
        options.showSaveError?.(
          "We could not reach the server just now. Your answers are safe and will be sent automatically — you can close this page, or press Try again.",
        );
      });
  });

  flushPending();

  /**
   * Practice feedback. Says what the answer implied and, where the answer was
   * not usable, what a usable one looks like -- the whole point of a practice
   * round. None of this appears on the real item.
   */
  function practiceCommentHtml(item) {
    const s = Number(survey.getValue(item.prior));
    const x = Number(survey.getValue(item.generatedX));
    const updated = Number(survey.getValue(item.updated));
    const moved = Math.abs(updated - s);
    const gap = Math.abs(x - s);
    const share = gap > 0 ? moved / gap : 0;

    let note;
    if (share <= 0.2) {
      note = `You moved ${formatCount(moved)} of the ${formatCount(gap)} between your
              estimate and the result, so we read you as holding your original view
              firmly. That is a perfectly good answer if it is what you believe.`;
    } else if (share >= 0.8) {
      note = `You moved almost all the way to the hypothetical result, so we read you
              as having held your original number loosely. That is a perfectly good
              answer if it is what you believe.`;
    } else {
      note = `You moved about ${formatPercent(share, 0)} of the way from your estimate
              toward the result, so we read you as holding your original view with
              moderate confidence.`;
    }

    return `<p class="fit-readout">${note}</p>`;
  }

  function practiceMissHtml(item) {
    const s = Number(survey.getValue(item.prior));
    const x = Number(survey.getValue(item.generatedX));
    const updated = survey.getValue(item.updated);
    const low = Math.min(s, x);
    const high = Math.max(s, x);
    const direction = x > s ? "higher" : "lower";

    return `
      <section class="scenario-card" role="note">
        <span class="scenario-eyebrow">Practice · let's look at that again</span>
        <p>You estimated <strong>${formatCount(s)}</strong> and then saw a hypothetical
        result of <strong>${formatCount(x)}</strong>. You answered
        <strong>${updated}</strong>.</p>
        <p>We could not read that as a revised belief. The result is ${direction} than
        your estimate, so seeing it should pull you somewhere <strong>between
        ${formatCount(low)} and ${formatCount(high)}</strong> &mdash; nearer your own
        number if you trust it, nearer the result if you do not.</p>
        <p>Answering exactly ${formatCount(s)} would say the result told you nothing;
        answering exactly ${formatCount(x)} would say your own view counted for
        nothing. Both are strong claims, and neither is usually what people mean.</p>
        <p>Nothing here is marked. Use the back of your mind for it on the next one.</p>
      </section>`;
  }

  function renderFitSummary(host, fit, item) {
    const lower = betaQuantile(0.05, fit.alpha, fit.beta);
    const upper = betaQuantile(0.95, fit.alpha, fit.beta);
    const lowerCount = Math.round(lower * N);
    const upperCount = Math.round(upper * N);
    const practice = Boolean(item && item.isPractice);
    const example = Boolean(item && item.isExample);

    // The real item asks whether the width feels right, because that answer is
    // the measurement. Practice and the worked example instead say what the
    // width means, so the respondent can read the output before it counts.
    let readout;
    if (example) {
      readout = `Someone who estimated ${EXAMPLE.prior}, saw ${EXAMPLE.evidence}, and
        revised to ${EXAMPLE.updated} is telling us the rate is most likely around
        ${formatPercent(fit.mu, 0)}, with roughly a 90% chance it lies between
        ${lowerCount} and ${upperCount} out of 100. Had they revised further, the
        curve would be wider; had they barely moved, narrower.`;
    } else if (practice) {
      readout = `We read your two answers as: the success rate is most likely around
        ${formatPercent(fit.mu, 0)}, and there is roughly a 90% chance it lies
        between ${lowerCount} and ${upperCount} out of 100. A narrower band means
        you told us you were more certain; a wider one, less.`;
    } else {
      readout = `This implies roughly a 90% chance that the true success rate lies
        between ${lowerCount} and ${upperCount} attempts out of 100. Does that
        feel much too narrow, much too wide, or about right?`;
    }

    host.innerHTML = `
      <section class="fit-card" aria-labelledby="fit-title">
        <div class="fit-card__header">
          <span class="fit-eyebrow">${
            example ? "Worked example" : practice ? "Practice · what we read" : "Implied uncertainty"
          }</span>
          <h3 id="fit-title">Underlying probability of success</h3>
        </div>
        <div class="fit-metrics">
          <div class="fit-metric">
            <span>Mean</span>
            <strong>${formatPercent(fit.mu, 0)}</strong>
          </div>
        </div>
        <p class="fit-readout">${readout}</p>
        ${practice ? practiceCommentHtml(item) : ""}
        <div class="chart-wrap">
          <canvas class="beta-chart" data-beta-chart role="img"></canvas>
        </div>
        <div class="chart-legend" aria-hidden="true">
          <span><i class="legend-swatch legend-swatch--mean"></i>Mean</span>
          <span><i class="legend-swatch legend-swatch--interval"></i>Central 90% interval</span>
        </div>
        <p class="fit-note">${
          example
            ? "This is the Beta distribution implied by that pair of answers and nothing else."
            : "This is the Beta distribution implied by your initial estimate and how far you updated after the hypothetical evidence."
        }</p>
      </section>`;

    const canvas = host.querySelector("[data-beta-chart]");
    canvas.setAttribute(
      "aria-label",
      `Beta density with mean ${formatPercent(fit.mu)} and a roughly 90 percent chance the true success rate lies between ${lowerCount} and ${upperCount} attempts out of 100.`,
    );
    drawBetaChart(canvas, fit, lower, upper);
  }

  // Axis steps rounded to 1, 2 or 5 x 10^n so the density labels read cleanly.
  function niceTicks(max, targetCount) {
    const rough = max / Math.max(1, targetCount);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalised = rough / magnitude;
    // Thresholds sit between the 1/2/5 options rather than on them, so the
    // step chosen is the one landing nearest to targetCount ticks.
    const step =
      (normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10) *
      magnitude;

    // Run up to the first tick at or above max, so the caller can use the last
    // tick as the axis maximum and the curve never touches the top edge.
    const topTick = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let index = 0; index * step <= topTick + step * 1e-9; index += 1) {
      ticks.push(Number((index * step).toFixed(10)));
    }

    return { ticks, step };
  }

  function formatDensity(value, step) {
    const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    return value.toFixed(decimals);
  }

  function drawBetaChart(canvas, fit, lowerInterval, upperInterval) {
    const cssWidth = Math.max(300, canvas.clientWidth || 680);
    const cssHeight = Math.max(220, canvas.clientHeight || 290);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const context = canvas.getContext("2d");
    context.scale(dpr, dpr);

    const samples = 500;
    const points = [];

    for (let index = 0; index <= samples; index += 1) {
      const x = index / samples;
      points.push({ x, y: betaDensity(x, fit.alpha, fit.beta) });
    }

    const finiteDensities = points
      .map((point) => point.y)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const rawMax = finiteDensities[finiteDensities.length - 1] || 1;
    const robustIndex = Math.floor((finiteDensities.length - 1) * 0.985);
    const robustMax = finiteDensities[robustIndex] || rawMax;
    const yMax = Math.max(1e-9, Math.min(rawMax, robustMax * 3));

    // The axis stops at the tick above the data, which keeps the curve from
    // touching the top edge and makes the top gridline a real value.
    const axisFont = "12px Manrope, system-ui, sans-serif";
    const { ticks: yTicks, step: yStep } = niceTicks(yMax, 4);
    const yAxisMax = yTicks[yTicks.length - 1] || yMax;

    // When alpha or beta drops below 1 the density diverges at an edge, so the
    // plot is deliberately capped. Label the axis honestly in that case rather
    // than letting the top tick imply that is the true peak.
    const peakClipped = rawMax > yAxisMax * 1.001;

    context.font = axisFont;
    const yLabelWidth = yTicks.reduce(
      (widest, tick) =>
        Math.max(widest, context.measureText(formatDensity(tick, yStep)).width),
      0,
    );

    const plot = {
      left: Math.ceil(yLabelWidth) + 34,
      right: cssWidth - 18,
      top: 18,
      bottom: cssHeight - 38,
    };
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;

    const mapX = (value) => plot.left + value * plotWidth;
    const mapY = (value) => plot.bottom - Math.min(value / yAxisMax, 1) * plotHeight;

    context.clearRect(0, 0, cssWidth, cssHeight);

    // Gridlines first, so the curve and interval band sit on top of them.
    context.strokeStyle = "#f1f1f3";
    context.lineWidth = 1;
    yTicks.forEach((tick) => {
      if (tick === 0) return;
      const y = Math.round(mapY(tick)) + 0.5;
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
    });

    // The shaded band marks the central 90% credible interval.
    context.fillStyle = "rgba(38, 52, 135, 0.10)";
    context.fillRect(
      mapX(lowerInterval),
      plot.top,
      mapX(upperInterval) - mapX(lowerInterval),
      plotHeight,
    );

    context.strokeStyle = "#e6e6e9";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, plot.bottom + 0.5);
    context.lineTo(plot.right, plot.bottom + 0.5);
    context.stroke();

    context.setLineDash([4, 5]);
    context.strokeStyle = "rgba(38, 52, 135, 0.55)";
    [lowerInterval, upperInterval].forEach((value) => {
      context.beginPath();
      context.moveTo(mapX(value), plot.top);
      context.lineTo(mapX(value), plot.bottom);
      context.stroke();
    });
    context.setLineDash([]);

    const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
    gradient.addColorStop(0, "rgba(38, 52, 135, 0.20)");
    gradient.addColorStop(1, "rgba(38, 52, 135, 0.02)");

    context.beginPath();
    context.moveTo(mapX(points[0].x), plot.bottom);
    points.forEach((point) => context.lineTo(mapX(point.x), mapY(point.y)));
    context.lineTo(mapX(points[points.length - 1].x), plot.bottom);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      const method = index === 0 ? "moveTo" : "lineTo";
      context[method](mapX(point.x), mapY(point.y));
    });
    context.strokeStyle = "#263487";
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.stroke();

    context.strokeStyle = "#1c1c1e";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(mapX(fit.mu), plot.top + 4);
    context.lineTo(mapX(fit.mu), plot.bottom);
    context.stroke();

    context.fillStyle = "#6b6b73";
    context.font = "12px Manrope, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
      const x = mapX(tick);
      context.strokeStyle = "#e6e6e9";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.bottom);
      context.lineTo(x, plot.bottom + 5);
      context.stroke();
      context.fillText(`${tick * 100}%`, x, plot.bottom + 10);
    });

    // Y axis: line, tick marks and density labels.
    context.strokeStyle = "#e6e6e9";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left - 0.5, plot.top);
    context.lineTo(plot.left - 0.5, plot.bottom);
    context.stroke();

    context.fillStyle = "#6b6b73";
    context.font = axisFont;
    context.textAlign = "right";
    context.textBaseline = "middle";
    yTicks.forEach((tick) => {
      const y = mapY(tick);
      context.beginPath();
      context.moveTo(plot.left - 5, y);
      context.lineTo(plot.left - 0.5, y);
      context.stroke();
      context.fillText(formatDensity(tick, yStep), plot.left - 9, y);
    });

    context.save();
    context.translate(10, plot.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillStyle = "#8a8a92";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(peakClipped ? "Density (peak off scale)" : "Density", 0, 0);
    context.restore();
  }

  document.addEventListener("DOMContentLoaded", () => {
    SurveyUI.renderSurvey(survey, document.getElementById("surveyContainer"));
  });
})();

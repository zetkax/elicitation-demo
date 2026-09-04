(() => {
  "use strict";

  const N = 100;
  const TARGET_TAIL = 0.1;
  const NUMERIC_EPSILON = 1e-12;

  /**
   * X-SELECTION RULE
   * ----------------
   * For s in 1..99, let mu=s/100 and K~Binomial(100, mu).
   * - mu < 0.5: choose X>s with P(K>=X) closest to 0.10.
   * - mu >= 0.5: choose X<s with P(K<=X) closest to 0.10.
   * Iterating outwards from s and updating only on a strict improvement makes
   * an exact tie prefer the less-extreme X. The 0 and 100 cases return null.
   */
  function chooseHypotheticalX(rawS) {
    const s = Number(rawS);

    if (!Number.isInteger(s) || s <= 0 || s >= N) {
      return null;
    }

    const mu = s / N;
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

    if (mu < 0.5) {
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
          s,
        )} and ${formatCount(x)} successes out of 100.`,
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
    title: "How capable is a restaurant-reservation AI?",
    description:
      "A short sequence turns your judgement into a simple uncertainty distribution. There are no right or wrong answers.",
    showQuestionNumbers: "off",
    showProgressBar: "top",
    progressBarType: "pages",
    showPrevButton: false,
    showPreviewBeforeComplete: "noPreview",
    pageNextText: "Continue",
    completeText: "Finish",
    questionErrorLocation: "bottom",
    checkErrorsMode: "onNextPage",
    clearInvisibleValues: "none",
    completedHtml:
      "<h3>Response recorded</h3><p>This prototype kept the response only in this browser session and logged it to the developer console.</p>",
    pages: [
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
            min: 0,
            max: 100,
            step: 0.1,
            isRequired: true,
            requiredErrorText: "Enter your updated estimate before continuing.",
            validators: [
              {
                type: "numeric",
                minValue: 0,
                maxValue: 100,
                text: "Enter a number from 0 to 100.",
              },
            ],
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
        visibleIf: "{prior_successes} > 0 and {prior_successes} < 100",
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
            title: "Does this look like a reasonable representation of your uncertainty?",
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
    ],
  };

  const survey = new Survey.Model(surveyJson);

  function isBoundaryValue(value) {
    const numeric = Number(value);
    return numeric === 0 || numeric === N;
  }

  function syncGeneratedX() {
    const rawS = survey.getValue("prior_successes");
    const s = Number(rawS);
    const x = chooseHypotheticalX(s);

    if (x === null) {
      if (isBoundaryValue(s)) {
        survey.setValue("generated_x", "not_applicable_boundary_case");
      } else {
        survey.clearValue("generated_x");
      }
      return;
    }

    survey.setValue("generated_x", x);

    const updatedQuestion = survey.getQuestionByName("updated_successes");
    if (updatedQuestion) {
      const low = Math.min(s, x);
      const high = Math.max(s, x);
      updatedQuestion.min = low + 0.1;
      updatedQuestion.max = high - 0.1;
      updatedQuestion.description = `Enter a number strictly between ${s} and ${x}. Decimals are welcome.`;
    }
  }

  function getCurrentFit() {
    return calculateBetaFit(
      survey.getValue("prior_successes"),
      survey.getValue("generated_x"),
      survey.getValue("updated_successes"),
    );
  }

  function saveDerivedFit(fit) {
    if (!fit.valid) return;

    const interval = [
      betaQuantile(0.05, fit.alpha, fit.beta),
      betaQuantile(0.95, fit.alpha, fit.beta),
    ];

    survey.setValue("fit_nu", fit.nu);
    survey.setValue("fit_alpha", fit.alpha);
    survey.setValue("fit_beta", fit.beta);
    survey.setValue("credible_interval_90", interval);
  }

  survey.onValueChanged.add((sender, options) => {
    if (options.name === "prior_successes") {
      syncGeneratedX();
      sender.clearValue("updated_successes");
      sender.clearValue("sanity_check");
      sender.clearValue("sanity_comment");
    }
  });

  survey.onValidateQuestion.add((sender, options) => {
    if (options.question.name === "prior_successes") {
      const value = Number(options.value);
      if (Number.isFinite(value) && !Number.isInteger(value)) {
        options.error = "Use a whole number for the initial estimate.";
      }
    }

    if (
      options.question.name === "updated_successes" &&
      options.value !== undefined &&
      options.value !== null &&
      options.value !== ""
    ) {
      const fit = getCurrentFit();
      if (!fit.valid) options.error = fit.reason;
    }
  });

  survey.onCurrentPageChanging.add((sender, options) => {
    if (options.oldCurrentPage?.name === "baseline") {
      syncGeneratedX();
    }

    if (
      options.oldCurrentPage?.name === "evidence" &&
      options.newCurrentPage?.name === "sanity"
    ) {
      const fit = getCurrentFit();
      if (!fit.valid) {
        options.allow = false;
        return;
      }
      saveDerivedFit(fit);
    }
  });

  survey.onAfterRenderQuestion.add((sender, options) => {
    if (options.question.name !== "beta_summary") return;

    const host = options.htmlElement.querySelector("[data-fit-host]");
    const fit = getCurrentFit();

    if (!host) return;
    if (!fit.valid) {
      host.innerHTML = `<p class="fit-error">${fit.reason}</p>`;
      return;
    }

    requestAnimationFrame(() => renderFitSummary(host, fit));
  });

  survey.onComplete.add((sender) => {
    // Prototype persistence: all requested raw values live in sender.data.
    // Boundary cases keep generated_x as a clear not-applicable marker and do
    // not invent Q2 or sanity-check answers that were never requested.
    console.log("Expert elicitation response:", sender.data);
    console.log(JSON.stringify(sender.data, null, 2));
  });

  function renderFitSummary(host, fit) {
    const lower = betaQuantile(0.05, fit.alpha, fit.beta);
    const upper = betaQuantile(0.95, fit.alpha, fit.beta);

    host.innerHTML = `
      <section class="fit-card" aria-labelledby="fit-title">
        <div class="fit-card__header">
          <span class="fit-eyebrow">Implied uncertainty</span>
          <h3 id="fit-title">Underlying probability of success</h3>
        </div>
        <div class="fit-metrics">
          <div class="fit-metric">
            <span>Mean</span>
            <strong>${formatPercent(fit.mu, 0)}</strong>
          </div>
          <div class="fit-metric">
            <span>Central 90% credible interval</span>
            <strong>${formatPercent(lower)}–${formatPercent(upper)}</strong>
          </div>
        </div>
        <div class="chart-wrap">
          <canvas class="beta-chart" data-beta-chart role="img"></canvas>
        </div>
        <div class="chart-legend" aria-hidden="true">
          <span><i class="legend-swatch legend-swatch--mean"></i>Mean</span>
          <span><i class="legend-swatch legend-swatch--interval"></i>Central 90% interval</span>
        </div>
        <p class="fit-note">This is the Beta distribution implied by your initial estimate and how far you updated after the hypothetical evidence.</p>
      </section>`;

    const canvas = host.querySelector("[data-beta-chart]");
    canvas.setAttribute(
      "aria-label",
      `Beta density with mean ${formatPercent(fit.mu)} and central 90 percent credible interval from ${formatPercent(lower)} to ${formatPercent(upper)}.`,
    );
    drawBetaChart(canvas, fit, lower, upper);
  }

  function drawBetaChart(canvas, fit, lowerInterval, upperInterval) {
    const cssWidth = Math.max(300, canvas.clientWidth || 680);
    const cssHeight = Math.max(220, canvas.clientHeight || 290);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const context = canvas.getContext("2d");
    context.scale(dpr, dpr);

    const plot = {
      left: 48,
      right: cssWidth - 18,
      top: 18,
      bottom: cssHeight - 38,
    };
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
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

    const mapX = (value) => plot.left + value * plotWidth;
    const mapY = (value) => plot.bottom - Math.min(value / yMax, 1) * plotHeight;

    context.clearRect(0, 0, cssWidth, cssHeight);

    // The shaded band marks the central 90% credible interval.
    context.fillStyle = "rgba(23, 107, 98, 0.10)";
    context.fillRect(
      mapX(lowerInterval),
      plot.top,
      mapX(upperInterval) - mapX(lowerInterval),
      plotHeight,
    );

    context.strokeStyle = "#d8e2de";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, plot.bottom + 0.5);
    context.lineTo(plot.right, plot.bottom + 0.5);
    context.stroke();

    context.setLineDash([4, 5]);
    context.strokeStyle = "rgba(23, 107, 98, 0.65)";
    [lowerInterval, upperInterval].forEach((value) => {
      context.beginPath();
      context.moveTo(mapX(value), plot.top);
      context.lineTo(mapX(value), plot.bottom);
      context.stroke();
    });
    context.setLineDash([]);

    const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
    gradient.addColorStop(0, "rgba(23, 107, 98, 0.24)");
    gradient.addColorStop(1, "rgba(23, 107, 98, 0.02)");

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
    context.strokeStyle = "#176b62";
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.stroke();

    context.strokeStyle = "#de704f";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(mapX(fit.mu), plot.top + 4);
    context.lineTo(mapX(fit.mu), plot.bottom);
    context.stroke();

    context.fillStyle = "#5d706d";
    context.font = "12px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
      const x = mapX(tick);
      context.strokeStyle = "#aebcb7";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.bottom);
      context.lineTo(x, plot.bottom + 5);
      context.stroke();
      context.fillText(`${tick * 100}%`, x, plot.bottom + 10);
    });

    context.save();
    context.translate(12, plot.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillStyle = "#7a8b87";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText("Relative density", 0, 0);
    context.restore();
  }

  document.addEventListener("DOMContentLoaded", () => {
    survey.render(document.getElementById("surveyContainer"));
  });
})();

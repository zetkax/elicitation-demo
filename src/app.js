/**
 * Entry point: builds the survey model and wires it to the DOM.
 *
 * Everything substantive lives in the sibling modules; this file is only the
 * wiring, so that what the survey *does* stays readable in one sitting.
 */
import { N, chooseHypotheticalX, calculateBetaFit, betaQuantile, classifyUpdate } from "./stats.js";
import { renderFitSummary } from "./chart.js";
import { practiceCommentHtml, practiceMissHtml } from "./feedback.js";
import { createStore } from "./persistence.js";
import { trainingPages } from "./pages/training.js";
import { mainPages } from "./pages/main.js";
import {
  ALL_ITEMS,
  ITEM_BY_PREFIX,
  MAIN_ITEM,
  EXAMPLE,
  PRIOR_PAGE_ITEM,
  UPDATE_PAGE_ITEM,
} from "./items.js";

const CONFIG = window.ELICITATION_CONFIG || {};
const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || "";
const SURVEY_VERSION = CONFIG.surveyVersion || "unversioned";
const SHOW_EXPECTED_RANGE = CONFIG.showExpectedRange !== false;
const STARTED_AT = new Date().toISOString();

const store = createStore({
  endpoint: RESULTS_ENDPOINT,
  surveyVersion: SURVEY_VERSION,
  startedAt: STARTED_AT,
});

export const surveyJson = {
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
  pages: [...trainingPages, ...mainPages],
};

export const survey = new Survey.Model(surveyJson);

function isBoundaryValue(value) {
  const numeric = Number(value);
  return numeric === 0 || numeric === N;
}

function syncGeneratedX(item) {
  const s = Number(survey.getValue(item.prior));
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

  const question = survey.getQuestionByName(item.updated);
  if (!question) return;

  const low = Math.min(s, x);
  const high = Math.max(s, x);

  // No min/max is applied. Stating the range while leaving the field open is
  // what makes non-compliance interpretable: an out-of-range answer is someone
  // disregarding an instruction they were given, not someone never told.
  question.description = SHOW_EXPECTED_RANGE
    ? `Your answer should fall between ${low} and ${high}. Decimals are welcome.`
    : "Decimals are welcome.";
}

function getFit(item) {
  return calculateBetaFit(
    survey.getValue(item.prior),
    survey.getValue(item.generatedX),
    survey.getValue(item.updated),
  );
}

function saveDerivedFit(item, fit) {
  survey.setValue(item.fitNu, fit.nu);
  survey.setValue(item.fitAlpha, fit.alpha);
  survey.setValue(item.fitBeta, fit.beta);
  survey.setValue(item.interval, [
    betaQuantile(0.05, fit.alpha, fit.beta),
    betaQuantile(0.95, fit.alpha, fit.beta),
  ]);
}

/**
 * Recomputes the derived columns for one item. Writes only keys other than
 * that item's prior/updated, so the onValueChanged listener that calls it
 * cannot re-enter.
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
  [item.fitNu, item.fitAlpha, item.fitBeta, item.interval].forEach((key) =>
    survey.clearValue(key),
  );
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

  const touched = priorOf || ALL_ITEMS.find((i) => i.updated === options.name);
  if (touched) refreshFitState(touched);
});

survey.onValidateQuestion.add((_sender, options) => {
  if (ALL_ITEMS.some((i) => i.prior === options.question.name)) {
    const value = Number(options.value);
    if (Number.isFinite(value) && !Number.isInteger(value)) {
      options.error = "Use a whole number for the initial estimate.";
    }
  }

  // The updated estimate is intentionally not validated. An answer outside the
  // stated range is data about the respondent, so it is recorded rather than
  // rejected, and the respondent gets no feedback that would coach them.
});

survey.onCurrentPageChanging.add((_sender, options) => {
  const leaving = options.oldCurrentPage?.name;
  if (PRIOR_PAGE_ITEM[leaving]) syncGeneratedX(PRIOR_PAGE_ITEM[leaving]);
  // Never blocks. An answer admitting no Beta fit simply leaves the dependent
  // page hidden (see its visibleIf) and the respondent continues.
  if (UPDATE_PAGE_ITEM[leaving]) refreshFitState(UPDATE_PAGE_ITEM[leaving]);
});

survey.onAfterRenderQuestion.add((_sender, options) => {
  const root = options.htmlElement;

  // The worked example is fixed, not the respondent's own answer -- it has to
  // be readable before they have given one.
  const exampleHost = root.querySelector("[data-example-fit]");
  if (exampleHost) {
    const fit = calculateBetaFit(EXAMPLE.prior, EXAMPLE.evidence, EXAMPLE.updated);
    if (fit.valid) {
      requestAnimationFrame(() =>
        renderFitSummary(exampleHost, fit, { mode: "example", example: EXAMPLE }),
      );
    }
    return;
  }

  const host = root.querySelector("[data-fit-host]");
  if (!host) return;

  const item = ITEM_BY_PREFIX.get(host.dataset.item || "") || MAIN_ITEM;
  const fit = getFit(item);
  const prior = Number(survey.getValue(item.prior));
  const evidence = Number(survey.getValue(item.generatedX));
  const updated = survey.getValue(item.updated);

  // Practice rounds explain what went wrong; the real item deliberately does
  // not, so that no feedback can shape the answer being measured.
  if (!fit.valid) {
    host.innerHTML = item.isPractice
      ? practiceMissHtml(prior, evidence, updated)
      : `<p class="fit-error">${fit.reason}</p>`;
    return;
  }

  requestAnimationFrame(() =>
    renderFitSummary(host, fit, {
      mode: item.isPractice ? "practice" : "real",
      commentHtml: item.isPractice
        ? practiceCommentHtml(prior, evidence, Number(updated))
        : "",
    }),
  );
});

// Built once and reused, so the "Try again" button on a failed save cannot
// mint a second response_id and file the same respondent twice.
let completionPayload = null;

survey.onComplete.add((sender, options) => {
  completionPayload = completionPayload || store.buildPayload(sender.data);
  const payload = completionPayload;
  console.log("Expert elicitation response:", payload);

  if (!RESULTS_ENDPOINT) {
    // No save banner at all. Claiming success would hide that nothing was
    // transmitted, and a red error would alarm a respondent who cannot act on
    // it. The response is buffered and flushes once an endpoint exists.
    store.queuePending(payload);
    console.warn(
      "No resultsEndpoint configured - response held in localStorage only. See apps-script/README.md.",
    );
    return;
  }

  options.showSaveInProgress?.("Saving your response…");

  store
    .postResponse(payload)
    .then(() => {
      store.dropPending(payload.response_id);
      options.showSaveSuccess?.("Response saved. Thank you.");
    })
    .catch((error) => {
      console.error("Could not save the response.", error);
      store.queuePending(payload);
      options.showSaveError?.(
        "We could not reach the server just now. Your answers are safe and will be sent automatically — you can close this page, or press Try again.",
      );
    });
});

store.flushPending();

document.addEventListener("DOMContentLoaded", () => {
  SurveyUI.renderSurvey(survey, document.getElementById("surveyContainer"));
});

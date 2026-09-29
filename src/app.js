import { chooseHypotheticalSamples, fitBetaUpdates, betaQuantile, classifyUpdate } from './stats.js';
import { renderPracticeExplorer } from './chart.js';
import { createStore } from './persistence.js';
import { trainingPages } from './pages/training.js';
import { mainPages } from './pages/main.js';
import { ALL_ITEMS, MAIN_ITEM } from './items.js';

const CONFIG = window.ELICITATION_CONFIG || {};
const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || '';
const store = createStore({ endpoint: RESULTS_ENDPOINT, surveyVersion: CONFIG.surveyVersion || 'unversioned', startedAt: new Date().toISOString() });
export const surveyJson = {
  title: 'How capable are AI agents at making restaurant reservations?',
  description: 'Your expectations and uncertainty, under specified conditions.',
  showQuestionNumbers: 'off', showProgressBar: false, showPrevButton: false,
  showPreviewBeforeComplete: 'noPreview', pageNextText: 'Continue', completeText: 'Finish',
  questionErrorLocation: 'bottom', checkErrorsMode: 'onNextPage', clearInvisibleValues: 'none',
  completedHtml: '<h3>Response recorded</h3><p>Thank you for taking part in this pilot.</p>',
  pages: [...trainingPages, ...mainPages],
};
export const survey = new Survey.Model(surveyJson);
const isPresent = v => v !== undefined && v !== null && String(v).trim() !== '';
function clearFit(item) {
  survey.setValue(item.fitValid, false);
  [item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50, item.diagnostics, item.invalidReason,
    item.classification, item.outOfRange].forEach(key => survey.clearValue(key));
}
export function saveMainFit() {
  const item = MAIN_ITEM;
  const samples = item.updates.map(r => ({ x: survey.getValue(r.evidence), updated: survey.getValue(r.answer) }));
  const fit = fitBetaUpdates(survey.getValue(item.prior), samples, 3);
  clearFit(item);
  survey.setValue(item.fitValid, fit.valid);
  survey.setValue(item.classification, classifyUpdate(Number(survey.getValue(item.prior)), Number(samples[0].x), Number(samples[0].updated)));
  survey.setValue(item.outOfRange, samples.some(r => Number(r.updated) < 0 || Number(r.updated) > 100));
  if (!fit.valid) {
    survey.setValue(item.invalidReason, fit.reason);
    return;
  }
  survey.setValue(item.fitNu, fit.nu);
  survey.setValue(item.fitAlpha, fit.alpha);
  survey.setValue(item.fitBeta, fit.beta);
  survey.setValue(item.diagnostics, fit.diagnostics);
  for (const [key, low, high] of [[item.interval, 0.05, 0.95], [item.interval50, 0.25, 0.75]]) {
    survey.setValue(key, [betaQuantile(low, fit.alpha, fit.beta), betaQuantile(high, fit.alpha, fit.beta)]);
  }
}
survey.onValueChanged.add((sender, options) => {
  const item = ALL_ITEMS.find(i => i.prior === options.name);
  if (item) {
    const raw = sender.getValue(item.prior);
    const evidence = isPresent(raw) ? chooseHypotheticalSamples(Number(raw)) : [];
    item.updates.forEach((r, i) => {
      sender.clearValue(r.answer);
      if (evidence.length) sender.setValue(r.evidence, evidence[i]);
      else sender.clearValue(r.evidence);
    });
    if (item.prefix === 'practice1') sender.clearValue('practice1_explored_update');
    clearFit(item);
  } else if (MAIN_ITEM.updates.some(r => r.answer === options.name)) clearFit(MAIN_ITEM);
});
survey.onValidateQuestion.add((_sender, options) => {
  if (ALL_ITEMS.some(i => i.prior === options.question.name) && isPresent(options.value) && !Number.isInteger(Number(options.value))) {
    options.error = 'Use a whole number for the initial estimate.';
  }
});
survey.onCurrentPageChanging.add((_sender, options) => {
  if (options.oldCurrentPage?.name === 'evidence_3') saveMainFit();
});
survey.onAfterRenderQuestion.add((_sender, options) => {
  if (survey.currentPage?.name !== 'practice1_feedback') return;
  const host = options.htmlElement.querySelector('[data-practice-explorer]');
  if (!host || !isPresent(survey.getValue('practice1_updated_successes'))) return;
  renderPracticeExplorer(host, {
    prior: Number(survey.getValue('practice1_prior_successes')),
    evidence: Number(survey.getValue('practice1_generated_x')),
    initial: Number(survey.getValue('practice1_updated_successes')),
    explored: survey.getValue('practice1_explored_update'),
    onChange: value => survey.setValue('practice1_explored_update', value),
  });
});
// Built once and reused, so the "Try again" button on a failed save cannot
// mint a second response_id and file the same respondent twice.
let completionPayload = null;

survey.onComplete.add((sender, options) => {
  saveMainFit();
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


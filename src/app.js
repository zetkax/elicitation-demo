import { chooseHypotheticalSamples, fitBetaUpdates, betaQuantile, classifyUpdate } from './stats.js';
import { renderPracticeExplorer, fitSummaryHtml, CHART_STYLES } from './chart.js';
import { createStore } from './persistence.js';
import { trainingPages } from './pages/training.js';
import { mainPages } from './pages/main.js';
import { ALL_ITEMS, MAIN_ITEM, PRACTICE_ITEMS } from './items.js';

const PRACTICE_2 = PRACTICE_ITEMS[1];

const CONFIG = window.ELICITATION_CONFIG || {};
const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || '';
const store = createStore({ endpoint: RESULTS_ENDPOINT, surveyVersion: CONFIG.surveyVersion || 'unversioned', startedAt: new Date().toISOString() });

// The chart the training explorer opens with; respondents can switch on the page.
const CHART_STYLE = CHART_STYLES.includes(CONFIG.chartStyle) ? CONFIG.chartStyle : 'line';
export const surveyJson = {
  title: 'How capable are AI agents at [insert domain]?',
  description: '',
  showQuestionNumbers: 'off', showProgressBar: false, showPrevButton: false,
  showPreviewBeforeComplete: 'noPreview', pageNextText: 'Continue', completeText: 'Finish',
  questionErrorLocation: 'bottom', checkErrorsMode: 'onNextPage', clearInvisibleValues: 'none',
  completedHtml: '<h3>Response recorded</h3><p>Thank you for taking part in this pilot.</p>',
  pages: [...trainingPages, ...mainPages],
};
export const survey = new Survey.Model(surveyJson);
// The style last shown is recorded with every response, and updated whenever
// the respondent switches, so data from the two styles never mixes unlabelled.
survey.setValue('chart_style', CHART_STYLE);
const isPresent = v => v !== undefined && v !== null && String(v).trim() !== '';
function clearFit(item) {
  survey.setValue(item.fitValid, false);
  [item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50, item.diagnostics, item.invalidReason,
    item.classification, item.outOfRange].forEach(key => survey.clearValue(key));
}
// The joint fit across all of an item's updates, from what is currently answered.
function currentFit(item) {
  const samples = item.updates.map(r => ({ x: survey.getValue(r.evidence), updated: survey.getValue(r.answer) }));
  return { samples, fit: fitBetaUpdates(survey.getValue(item.prior), samples, item.updates.length) };
}
export function saveMainFit() { saveFit(MAIN_ITEM); }
function saveFit(item) {
  const { samples, fit } = currentFit(item);
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
  // Practice 2's fit is shown on the page right after its last update, so it
  // is kept current as answers come in: its visibleIf must already be settled
  // when the respondent presses Continue.
  if (PRACTICE_2.updates.some(r => r.answer === options.name)) saveFit(PRACTICE_2);
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
  // Practice 2's joint fit, shown once for the too-narrow / too-wide check.
  // Drawn in whichever chart style they last chose in the practice 1 explorer.
  const fitHost = options.htmlElement.querySelector('[data-practice2-fit]');
  if (fitHost) {
    const { fit } = currentFit(PRACTICE_2);
    fitHost.innerHTML = fit.valid ? fitSummaryHtml(fit, survey.getValue('chart_style') || CHART_STYLE) : '';
    return;
  }
  if (survey.currentPage?.name !== 'practice1_feedback') return;
  const host = options.htmlElement.querySelector('[data-practice-explorer]');
  if (!host || !isPresent(survey.getValue('practice1_updated_successes'))) return;
  renderPracticeExplorer(host, {
    prior: Number(survey.getValue('practice1_prior_successes')),
    evidence: Number(survey.getValue('practice1_generated_x')),
    initial: Number(survey.getValue('practice1_updated_successes')),
    explored: survey.getValue('practice1_explored_update'),
    onChange: value => survey.setValue('practice1_explored_update', value),
    // Re-rendering the page keeps whichever style they last picked.
    chartStyle: survey.getValue('chart_style') || CHART_STYLE,
    onChartStyleChange: style => {
      survey.setValue('chart_style', style);
      survey.setValue('chart_style_switched', true);
    },
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


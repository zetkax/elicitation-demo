import { chooseHypotheticalSamples, fitBetaUpdates, betaQuantile, classifyUpdate, shuffle } from './stats.js';
import { renderPracticeExplorer, fitSummaryHtml, CHART_STYLES } from './chart.js';
import { createStore } from './persistence.js';
import { consentPage } from './pages/consent.js';
import { trainingPages } from './pages/training.js';
import { buildMainPages } from './pages/main.js';
import { ALL_ITEMS, QUESTION_ITEMS, THREE_UPDATE_ITEMS } from './items.js';

// A fresh random order of the main questions for each respondent. Only what is
// shown moves: every question's data keeps its own columns, and the order
// itself is recorded (question_order, plus each question's _position).
const QUESTION_ORDER = shuffle(QUESTION_ITEMS, Math.random);


const CONFIG = window.ELICITATION_CONFIG || {};
const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || '';
const store = createStore({ endpoint: RESULTS_ENDPOINT, surveyVersion: CONFIG.surveyVersion || 'unversioned', startedAt: new Date().toISOString() });

// The chart the training explorer opens with; respondents can switch on the page.
const CHART_STYLE = CHART_STYLES.includes(CONFIG.chartStyle) ? CONFIG.chartStyle : 'line';
export const surveyJson = {
  title: 'How capable are AI agents at [insert domain]?',
  description: '',
  showQuestionNumbers: 'off', showProgressBar: false, showPrevButton: true, pagePrevText: 'Back',
  showPreviewBeforeComplete: 'noPreview', pageNextText: 'Continue', completeText: 'Finish',
  questionErrorLocation: 'bottom', checkErrorsMode: 'onNextPage', clearInvisibleValues: 'none',
  completedHtml: '<h3>Response recorded</h3><p>Thank you for taking part in this pilot.</p>',
  pages: [consentPage, ...trainingPages, ...buildMainPages(QUESTION_ORDER)],
};
export const survey = new Survey.Model(surveyJson);
survey.setValue('question_order', QUESTION_ORDER.map(item => item.prefix));
QUESTION_ORDER.forEach((item, i) => survey.setValue(item.position, i + 1));
// The style last shown is recorded with every response, and updated whenever
// the respondent switches, so data from the two styles never mixes unlabelled.
survey.setValue('chart_style', CHART_STYLE);
// requireAnswers: false in config.js lets every question be skipped, to click
// through the pilot quickly. Consent is the exception: it always has to be
// given. Whether answers were optional is recorded with the response, so
// skipped answers are never mistaken for a broken form.
const REQUIRE_ANSWERS = CONFIG.requireAnswers !== false;
if (!REQUIRE_ANSWERS) {
  survey.getAllQuestions().filter(q => q.name !== 'consent').forEach(q => {
    q.isRequired = false;
    q.requiredIf = '';
  });
}
survey.setValue('answers_required', REQUIRE_ANSWERS);
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
    const samples = isPresent(raw) ? chooseHypotheticalSamples(Number(raw), { count: item.updates.length }) : [];
    item.updates.forEach((r, i) => {
      sender.clearValue(r.answer);
      if (samples.length) sender.setValue(r.evidence, samples[i].x);
      else sender.clearValue(r.evidence);
    });
    if (samples.length) sender.setValue(item.evidenceKinds, samples.map(e => e.kind));
    else sender.clearValue(item.evidenceKinds);
    if (item.prefix === 'practice1') sender.clearValue('practice1_explored_update');
    clearFit(item);
  }
  // Every three-update item (practice 2 and each main question) shows its fit
  // on the page right after its last update, so the fit is kept current as
  // answers come in: that page's visibleIf must already be settled when the
  // respondent presses Continue. Fewer than three answers is not a fit, so
  // nothing partial is ever saved.
  for (const three of THREE_UPDATE_ITEMS) {
    const isAnswer = three.updates.some(r => r.answer === options.name);
    if (isAnswer) saveFit(three);
    // Respondents can go Back. A "too narrow / too wide" verdict was about
    // the curve their answers produced then, so it is cleared when those
    // answers change and they are asked again about the new curve.
    if (isAnswer || options.name === three.prior) sender.clearValue(three.widthCheck);
  }
  // Likewise, exploration started from their practice 1 answer; a new answer
  // restarts the explorer from it rather than from a value explored earlier.
  if (options.name === 'practice1_updated_successes') sender.clearValue('practice1_explored_update');
});
survey.onValidateQuestion.add((_sender, options) => {
  if (ALL_ITEMS.some(i => i.prior === options.question.name) && isPresent(options.value) && !Number.isInteger(Number(options.value))) {
    options.error = 'Use a whole number for the initial estimate.';
  }
});
survey.onAfterRenderQuestion.add((_sender, options) => {
  // An item's joint fit, shown once for the too-narrow / too-wide check (after
  // practice 2 and after the real question). Drawn in whichever chart style
  // they last chose in the practice 1 explorer.
  const fitHost = options.htmlElement.querySelector('[data-fit-check]');
  if (fitHost) {
    const item = ALL_ITEMS.find(i => i.prefix === fitHost.dataset.fitCheck);
    const { fit } = currentFit(item);
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
  // Fits are already kept current as answers change; recomputing them all here
  // is a final guarantee that what is sent matches the answers sent with it.
  THREE_UPDATE_ITEMS.forEach(saveFit);
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


import { fitBetaUpdates, betaQuantile, classifyUpdate } from './stats.js';
import { generateEvidence, EVIDENCE_RULE } from './evidence.js';
import { fitSummaryHtml, CHART_STYLES } from './chart.js';
import { renderChips, chipsError } from './chips.js';
import { createStore } from './persistence.js';
import { consentPage } from './pages/consent.js';
import { trainingPages } from './pages/training.js';
import { buildMainSection } from './pages/main.js';
import { assignParticipant, parseVariant, planSummary } from './assignment.js';
import { QUESTIONS } from './questions.js';
import { PRACTICE, DIAG_FIELDS, CONSISTENCY } from './items.js';

const CONFIG = window.ELICITATION_CONFIG || {};
const RESULTS_ENDPOINT = CONFIG.resultsEndpoint || '';
const store = createStore({ endpoint: RESULTS_ENDPOINT, surveyVersion: CONFIG.surveyVersion || 'unversioned', startedAt: new Date().toISOString() });

// Everything random about this participant is decided once, here: version
// A/B/C (from ?variant=, else at random), each question's method, the Update
// sample sizes, the question order, the consistency target and the
// low-probability denominator. See assignment.js.
export const plan = assignParticipant(QUESTIONS, { variant: parseVariant(window.location?.search || '') });
export const mainSection = buildMainSection(plan);
const { entries, boundaries } = mainSection;

// The fitted-distribution chart style (no longer switchable in training).
const CHART_STYLE = CHART_STYLES.includes(CONFIG.chartStyle) ? CONFIG.chartStyle : 'line';
export const surveyJson = {
  title: 'How capable are AI agents at [insert domain]?',
  description: '',
  showQuestionNumbers: 'off', showProgressBar: false, showPrevButton: true, pagePrevText: 'Back',
  showPreviewBeforeComplete: 'noPreview', pageNextText: 'Continue', completeText: 'Finish',
  questionErrorLocation: 'bottom', checkErrorsMode: 'onNextPage', clearInvisibleValues: 'none',
  completedHtml: '<h3>Response recorded</h3><p>Thank you for taking part in this pilot.</p>',
  calculatedValues: mainSection.calculatedValues,
  pages: [consentPage, ...trainingPages, ...mainSection.pages],
};
export const survey = new Survey.Model(surveyJson);

// The assignment travels with the response, so a run can be rebuilt from it.
survey.setValue('survey_variant', plan.variant);
survey.setValue('variant_source', plan.variantSource);
survey.setValue('question_order', plan.main.map((e) => e.id));
survey.setValue('main_plan', planSummary(plan));
for (const { item, method, position, updateN } of entries) {
  survey.setValue(item.method, method);
  survey.setValue(item.position, position);
  if (method === 'update') survey.setValue(item.updateN, updateN);
}
survey.setValue(CONSISTENCY.target, plan.consistencyTarget);
survey.setValue(DIAG_FIELDS.lowprob.denominator, plan.lowProbDenominator);
survey.setValue('evidence_rule', EVIDENCE_RULE.name);
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

/* ---------- Registries for this participant ---------- */

const ofMethod = (method) => entries.filter((e) => e.method === method).map((e) => e.item);
const MAIN_UPDATES = ofMethod('update').map((i) => i.update);
const RARE_ITEMS = ofMethod('update').map((i) => i.rare);
// Every item with hypothetical results and a joint fit.
const FIT_ITEMS = [PRACTICE.update, ...MAIN_UPDATES, ...RARE_ITEMS];
const PERCENTILE_SETS = [PRACTICE.percentiles, ...ofMethod('percentiles').map((i) => i.percentiles)];
const CHIPS_FIELDS = [PRACTICE.chips, ...ofMethod('chips').map((i) => i.chips)];
const rareOf = (boundary) => RARE_ITEMS.find((r) => r.boundary === boundary);

const isPresent = v => v !== undefined && v !== null && String(v).trim() !== '';

/* ---------- Update: evidence and fits ---------- */

function clearFit(item) {
  survey.setValue(item.fitValid, false);
  [item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50, item.diagnostics, item.invalidReason,
    item.classification, item.outOfRange].forEach(key => survey.clearValue(key));
}
// The joint fit across all of an item's updates, from what is currently answered.
function currentFit(item) {
  const samples = item.updates.map(r => ({ x: survey.getValue(r.evidence), updated: survey.getValue(r.answer) }));
  return { samples, fit: fitBetaUpdates(survey.getValue(item.prior), samples, item.updates.length, item.n, item.scale) };
}
// A fine-scale block is in use only once its estimate has been given; until
// then none of its columns are sent.
const inUse = item => !item.isRare || isPresent(survey.getValue(item.prior));
function saveFit(item) {
  if (!inUse(item)) return;
  const { samples, fit } = currentFit(item);
  clearFit(item);
  survey.setValue(item.fitValid, fit.valid);
  // Evidence is put on the estimate's scale, so 12/20 compares with 60/100.
  const first = samples[0];
  survey.setValue(item.classification, classifyUpdate(Number(survey.getValue(item.prior)),
    Number(first.x) * item.scale / item.n, Number(first.updated)));
  survey.setValue(item.outOfRange, samples.some(r => Number(r.updated) < 0 || Number(r.updated) > item.scale));
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

/* ---------- The 0 / maximum follow-ups ---------- */

// Clearing fires onValueChanged for each key; `resetting` stops that from
// re-deriving values (an empty fit, say) partway through the reset.
let resetting = false;
function resetBoundary(b, { keepMeaning = false } = {}) {
  const keys = [...(keepMeaning ? [] : [b.meaning]), b.fine, b.fineCounts, ...(rareOf(b)?.dataKeys || [])];
  resetting = true;
  try { keys.forEach(key => survey.clearValue(key)); }
  finally { resetting = false; }
}

survey.onValueChanged.add((sender, options) => {
  if (resetting) return;
  const { name } = options;

  for (const b of boundaries) {
    // A new original answer starts its follow-up afresh; the original itself
    // is never changed.
    if (name === b.source) resetBoundary(b);
    if (name === b.meaning) {
      resetBoundary(b, { keepMeaning: true });
      if (options.value === 'very_rare' || options.value === 'not_certain') {
        const atMax = Number(sender.getValue(b.source)) === b.max;
        sender.setValue(b.fineCounts, b.words.counts[atMax ? 1 : 0]);
      }
    }
  }

  if (name === DIAG_FIELDS.lowprob.answer) {
    const v = options.value;
    if (isPresent(v)) sender.setValue(DIAG_FIELDS.lowprob.probability, Number(v) / plan.lowProbDenominator);
    else sender.clearValue(DIAG_FIELDS.lowprob.probability);
  }

  // A new initial estimate draws new hypothetical evidence (evidence.js).
  const item = FIT_ITEMS.find(i => i.prior === name);
  if (item) {
    const raw = sender.getValue(item.prior);
    // A main question at 0 or 100 skips its usual updates for the follow-up,
    // so no evidence is generated for them. (The practice still shows them.)
    const mainAtEnd = MAIN_UPDATES.includes(item) && isPresent(raw) && (Number(raw) === 0 || Number(raw) === item.scale);
    const samples = !isPresent(raw) || mainAtEnd ? []
      : generateEvidence(Number(raw), { n: item.n, scale: item.scale, count: item.updates.length });
    item.updates.forEach((r, i) => {
      sender.clearValue(r.answer);
      if (samples.length) sender.setValue(r.evidence, samples[i].x);
      else sender.clearValue(r.evidence);
    });
    if (samples.length) {
      sender.setValue(item.evidenceKinds, samples.map(e => e.kind));
      sender.setValue(item.evidenceTails, samples.map(e => e.tail));
    } else {
      sender.clearValue(item.evidenceKinds);
      sender.clearValue(item.evidenceTails);
    }
    if (inUse(item)) clearFit(item);
  }
  // Each fit is shown on the page right after its last update, so it is kept
  // current as answers come in: that page's visibleIf must already be settled
  // when the respondent presses Continue. Fewer answers than updates is not a
  // fit, so nothing partial is ever saved.
  for (const fitItem of FIT_ITEMS) {
    const isAnswer = fitItem.updates.some(r => r.answer === name);
    if (isAnswer) saveFit(fitItem);
    // Respondents can go Back. A "too narrow / too wide" verdict was about
    // the curve their answers produced then, so it is cleared when those
    // answers change and they are asked again about the new curve.
    if (isAnswer || name === fitItem.prior) sender.clearValue(fitItem.widthCheck);
  }
});

/* ---------- Validation ---------- */

const WHOLE_NUMBER_FIELDS = new Set([...FIT_ITEMS.map(i => i.prior), ...boundaries.map(b => b.fine)]);
survey.onValidateQuestion.add((sender, options) => {
  const { name } = options.question;
  const value = options.value;
  if (!isPresent(value)) return;
  if (WHOLE_NUMBER_FIELDS.has(name) && !Number.isInteger(Number(value))) {
    options.error = 'Use a whole number for this estimate.';
    return;
  }
  // Percentiles must be in order: p10 <= p50 <= p90.
  for (const p of PERCENTILE_SETS) {
    const get = (key) => sender.getValue(key);
    if (name === p.p50 && isPresent(get(p.p10)) && Number(value) < Number(get(p.p10))) {
      options.error = 'Your 50th percentile cannot be lower than your 10th percentile.';
    }
    if (name === p.p90) {
      if (isPresent(get(p.p50)) && Number(value) < Number(get(p.p50))) {
        options.error = 'Your 90th percentile cannot be lower than your 50th percentile.';
      } else if (isPresent(get(p.p10)) && Number(value) < Number(get(p.p10))) {
        options.error = 'Your 90th percentile cannot be lower than your 10th percentile.';
      }
    }
  }
});

// Chips are not a SurveyJS question, so an incomplete allocation is caught
// here: Continue stays on the page and says how many chips are left.
const chipsFieldOn = (page) => CHIPS_FIELDS.find(field => page?.getQuestionByName(`${field}_widget`));
survey.onCurrentPageChanging.add((sender, options) => {
  if (!options.isGoingForward) return;
  const field = chipsFieldOn(options.oldCurrentPage);
  if (!field) return;
  const error = chipsError(sender.getValue(field), { allowEmpty: !REQUIRE_ANSWERS });
  if (error) {
    options.allow = false;
    options.message = error;
  }
});

/* ---------- Rendering ---------- */

survey.onAfterRenderQuestion.add((_sender, options) => {
  const chipsHost = options.htmlElement.querySelector('[data-chips]');
  if (chipsHost) {
    const field = chipsHost.dataset.chips;
    renderChips(chipsHost, { value: survey.getValue(field), onChange: value => survey.setValue(field, value) });
    return;
  }
  // An item's joint fit, shown once for the too-narrow / too-wide check.
  const fitHost = options.htmlElement.querySelector('[data-fit-check]');
  if (fitHost) {
    const item = FIT_ITEMS.find(i => i.prefix === fitHost.dataset.fitCheck);
    const { fit } = currentFit(item);
    // On the fine scale the axis is zoomed in to where the belief lies, and
    // names the rare outcome the respondent was counting.
    const rareView = item.isRare
      ? { zoom: true, rateName: survey.getValue(item.boundary.fineCounts) === 'failures' ? 'failure rate' : 'success rate' }
      : {};
    fitHost.innerHTML = fit.valid ? fitSummaryHtml(fit, CHART_STYLE, rareView) : '';
  }
});

/* ---------- Saving ---------- */

// Built once and reused, so the "Try again" button on a failed save cannot
// mint a second response_id and file the same respondent twice.
let completionPayload = null;

survey.onComplete.add((sender, options) => {
  // Fits are already kept current as answers change; recomputing them all here
  // is a final guarantee that what is sent matches the answers sent with it.
  FIT_ITEMS.forEach(saveFit);
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

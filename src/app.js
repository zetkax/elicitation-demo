import { fitBetaUpdates, betaQuantile, classifyUpdate } from './stats.js';
import { generateEvidence, EVIDENCE_RULE } from './evidence.js';
import { fitSummaryHtml, trainingFeedbackHtml, trainingFeedbackMissingHtml, CHART_STYLES } from './chart.js';
import { fitBetaToPercentiles, fitBetaToChips } from './fitting.js';
import { renderChips, chipsError } from './chips.js';
import { createStore } from './persistence.js';
import { consentPage } from './pages/consent.js';
import { trainingPages } from './pages/training.js';
import { buildMainSection } from './pages/main.js';
import { assignParticipant, parseVariant, planSummary } from './assignment.js';
import { QUESTIONS } from './questions.js';
import { PRACTICE, DIAG_FIELDS, CONSISTENCY, feedbackFields } from './items.js';
import { DIAGNOSTICS } from './diagnostics.js';

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
// Percentiles and Chips answers with a smooth approximation kept beside them
// (fitting.js). `key` names the training feedback host that draws it.
const SHAPE_SOURCES = [
  { kind: 'percentiles', fields: PRACTICE.percentiles, fit: PRACTICE.percentilesFit, key: 'practice_percentiles' },
  { kind: 'chips', field: PRACTICE.chips, fit: PRACTICE.chipsFit, key: 'practice_chips' },
  ...ofMethod('percentiles').map((i) => ({ kind: 'percentiles', fields: i.percentiles, fit: i.shapeFit, key: i.id })),
  ...ofMethod('chips').map((i) => ({ kind: 'chips', field: i.chips, fit: i.shapeFit, key: i.id })),
];
// Main questions' feedback-and-revision loop (see the section below).
const FIRST_PAGE = { percentiles: '_percentiles', chips: '_chips', update: '_estimate' };
const FEEDBACK = entries.map(({ id, method, item }) => ({
  id, method, item, f: item.feedback, fields: feedbackFields(item, method), firstPage: `${id}${FIRST_PAGE[method]}`,
}));
const shapeInputs = (src) => (src.kind === 'percentiles' ? Object.values(src.fields) : [src.field]);

const isPresent = v => v !== undefined && v !== null && String(v).trim() !== '';

/* ---------- Update: evidence and fits ---------- */

function clearFit(item) {
  survey.setValue(item.fitValid, false);
  [item.fitNu, item.fitAlpha, item.fitBeta, item.interval, item.interval50,
    item.fitP10, item.fitP50, item.fitP90, item.diagnostics, item.invalidReason,
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
  for (const [key, p] of [[item.fitP10, 0.1], [item.fitP50, 0.5], [item.fitP90, 0.9]]) {
    survey.setValue(key, betaQuantile(p, fit.alpha, fit.beta) * item.scale);
  }
}

/* ---------- Percentiles and Chips: smooth approximations ---------- */

// The fit of a source's current raw answers. The raw answers are never touched.
function shapeFit(src) {
  if (src.kind === 'percentiles') {
    const { p10, p50, p90 } = src.fields;
    return fitBetaToPercentiles(survey.getValue(p10), survey.getValue(p50), survey.getValue(p90));
  }
  return fitBetaToChips(survey.getValue(src.field));
}
function saveShapeFit(src) {
  const fit = shapeFit(src);
  src.fit.dataKeys.forEach((key) => survey.clearValue(key));
  // Nothing (or not enough) answered yet: no columns at all.
  if (!fit.valid && (fit.reason === 'incomplete' || fit.reason === 'out_of_order')) return;
  survey.setValue(src.fit.valid, fit.valid);
  survey.setValue(src.fit.method, fit.method);
  if (!fit.valid) {
    survey.setValue(src.fit.invalidReason, fit.reason);
    return;
  }
  survey.setValue(src.fit.alpha, fit.alpha);
  survey.setValue(src.fit.beta, fit.beta);
  survey.setValue(src.fit.rmse, fit.rmse);
  survey.setValue(src.fit.p10, fit.p10 * 100);
  survey.setValue(src.fit.p50, fit.p50 * 100);
  survey.setValue(src.fit.p90, fit.p90 * 100);
}

/* ---------- Main questions: fitted feedback and revision ---------- */

/*
 * Each main question's feedback page shows the curve its answer implies and
 * asks whether that is the uncertainty intended; Edit my answer goes back to
 * the question with the answer still in place, and the way forward leads back
 * to the feedback page with a fresh fit. Kept for every question:
 *   <id>_original_<field>      the raw answer and its fit as first submitted,
 *                              copied once, on first reaching the feedback page
 *   the usual columns          the final answer and its fit
 *   <id>_fit_feedback(_other)  the final judgment; _first(_other) the first one
 *   <id>_revision_count        times the answer reached the feedback page changed
 *   <id>_edit_requests         Edit my answer clicks
 *   <id>_revision_history      every visit: answer, fit, judgment, next step
 * Revisions are counted by comparing answers, so a change made via Back
 * counts the same as one made via Edit.
 */
const strip = (fb, key) => key.slice(fb.id.length + 1);
const rawAnswer = (fb) => Object.fromEntries(fb.fields.raw.map((k) => [strip(fb, k), survey.getValue(k)]).filter(([, v]) => v !== undefined));
function fitSummary(fb) {
  const keys = fb.method === 'update'
    ? { p10: fb.item.update.fitP10, p50: fb.item.update.fitP50, p90: fb.item.update.fitP90, valid: fb.item.update.fitValid }
    : { p10: fb.item.shapeFit.p10, p50: fb.item.shapeFit.p50, p90: fb.item.shapeFit.p90, valid: fb.item.shapeFit.valid, rmse: fb.item.shapeFit.rmse };
  return Object.fromEntries(Object.entries(keys).map(([k, key]) => [k, survey.getValue(key) ?? null]));
}
const lastSeen = new Map(); // id -> the answer as it last reached the feedback page

function arriveAtFeedback(fb) {
  const answer = JSON.stringify(rawAnswer(fb));
  if (survey.getValue(fb.f.revisionCount) === undefined) {
    // First arrival: keep the original answer and fit before any feedback.
    for (const key of [...fb.fields.raw, ...fb.fields.fit]) {
      const v = survey.getValue(key);
      if (v !== undefined) survey.setValue(fb.item.feedback.original(key), v);
    }
    survey.setValue(fb.f.revisionCount, 0);
    survey.setValue(fb.f.editRequests, 0);
  } else if (answer !== lastSeen.get(fb.id)) {
    survey.setValue(fb.f.revisionCount, survey.getValue(fb.f.revisionCount) + 1);
    // A verdict on the old curve does not carry over to the new one.
    survey.clearValue(fb.f.judgment);
    survey.clearValue(fb.f.other);
  }
  lastSeen.set(fb.id, answer);
}
function leaveFeedback(fb, action) {
  const judgment = survey.getValue(fb.f.judgment);
  const other = survey.getValue(fb.f.other);
  const history = survey.getValue(fb.f.history) || [];
  survey.setValue(fb.f.history, [...history, { round: history.length + 1, action, answer: rawAnswer(fb),
    fit: fitSummary(fb), judgment: judgment ?? null, other: other ?? null }]);
  if (survey.getValue(fb.f.firstJudgment) === undefined && judgment !== undefined) {
    survey.setValue(fb.f.firstJudgment, judgment);
    if (other !== undefined) survey.setValue(fb.f.firstOther, other);
  }
  if (action === 'edit') survey.setValue(fb.f.editRequests, (survey.getValue(fb.f.editRequests) || 0) + 1);
}
// Set while Edit my answer moves the page, so that move is not also logged as Back.
let jumping = false;
/** Edit my answer: back to the question itself, answer still filled in. */
export function requestEdit(id) {
  const fb = FEEDBACK.find((x) => x.id === id);
  leaveFeedback(fb, 'edit');
  jumping = true;
  try { survey.currentPage = survey.getPageByName(fb.firstPage); }
  finally { jumping = false; }
}
const feedbackOf = (page) => page && FEEDBACK.find((fb) => fb.f.page === page.name);

/*
 * When editing is offered -- any judgment but "about right", or no curve to
 * judge -- Edit my answer takes Continue's usual place as the main button, and
 * Continue becomes a plain "Continue without changes" to its right, so a
 * habitual click on the usual spot edits rather than moves on.
 */
const NEXT = survey.navigationBar.getActionById('sv-nav-next');
const NEXT_DEFAULT = { title: NEXT.title, innerCss: NEXT.innerCss };
const editAction = survey.addNavigationItem({
  id: 'nav-edit', title: 'Edit my answer', visibleIndex: 25, visible: false,
  innerCss: NEXT_DEFAULT.innerCss, // the main-button style
  action: () => { const fb = feedbackOf(survey.currentPage); if (fb) requestEdit(fb.id); },
});
export function editOffered(fb) {
  if (!fb) return false;
  if (survey.getValue(`${fb.id}_fit_valid`) !== true) return true;
  const judgment = survey.getValue(fb.f.judgment);
  return judgment !== undefined && judgment !== 'about_right';
}
function refreshNavigation() {
  const offered = editOffered(feedbackOf(survey.currentPage));
  editAction.visible = offered;
  // styles.css matches this label to keep the button secondary on mobile.
  NEXT.title = offered ? 'Continue without changes' : NEXT_DEFAULT.title;
  NEXT.innerCss = offered ? 'sd-btn sd-navigation__keep-btn' : NEXT_DEFAULT.innerCss;
}
survey.onCurrentPageChanged.add((_sender, options) => {
  const fb = feedbackOf(options.newCurrentPage);
  if (fb) arriveAtFeedback(fb);
  refreshNavigation();
});
survey.onValueChanged.add(() => refreshNavigation());
survey.onCurrentPageChanging.add((_sender, options) => {
  const fb = feedbackOf(options.oldCurrentPage);
  if (fb && !jumping) leaveFeedback(fb, options.isGoingForward ? 'continue' : 'back');
});

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

  for (const src of SHAPE_SOURCES) if (shapeInputs(src).includes(name)) saveShapeFit(src);

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

const WHOLE_NUMBER_FIELDS = new Set([...FIT_ITEMS.map(i => i.prior), ...boundaries.map(b => b.fine),
  ...Object.values(DIAGNOSTICS).filter(d => d.integer).map(d => DIAG_FIELDS[d.id].answer)]);
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
  // The smooth curve an answer implies: after each practice format, and on
  // every main question's feedback page.
  const feedbackHost = options.htmlElement.querySelector('[data-feedback]');
  if (feedbackHost) {
    const key = feedbackHost.dataset.feedback;
    const updateEntry = FEEDBACK.find((fb) => fb.id === key && fb.method === 'update');
    if (updateEntry) {
      const { fit } = currentFit(updateEntry.item.update);
      feedbackHost.innerHTML = fit.valid ? trainingFeedbackHtml(fit) : trainingFeedbackMissingHtml(fit.reason);
      return;
    }
    const src = SHAPE_SOURCES.find((s) => s.key === key);
    const fit = shapeFit(src);
    const raw = src.kind === 'chips'
      ? { histogram: survey.getValue(src.field) }
      : { markers: Object.values(src.fields).map((key) => Number(survey.getValue(key))) };
    feedbackHost.innerHTML = fit.valid ? trainingFeedbackHtml(fit, raw) : trainingFeedbackMissingHtml(fit.reason);
    return;
  }
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
    // counts the rare outcome the respondent was counting, out of 10,000.
    const view = item.isRare
      ? { zoom: true, per: item.scale, noun: survey.getValue(item.boundary.fineCounts) === 'failures' ? 'failures' : 'successes' }
      : { per: item.scale };
    // The Update practice uses the same feedback card as the other two
    // training formats; main questions keep their own chart.
    fitHost.innerHTML = !fit.valid ? '' : item.isPractice ? trainingFeedbackHtml(fit) : fitSummaryHtml(fit, CHART_STYLE, view);
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
  SHAPE_SOURCES.forEach(saveShapeFit);
  // The consistency repeat is compared with the target's final median; its
  // first median (before feedback) is kept too.
  const target = plan.consistencyTarget;
  if (target) {
    survey.setValue('consistency_target_p50', sender.getValue(`${target}_p50`));
    survey.setValue('consistency_target_p50_original', sender.getValue(`${target}_original_p50`));
  }
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

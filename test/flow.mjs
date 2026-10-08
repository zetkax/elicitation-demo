/**
 * Integration test. Shims the browser globals app.js expects, imports it, and
 * drives the real model through the real handlers -- so assignment, page
 * routing, validation, the 0/100 follow-ups and the outgoing payload are all
 * exercised as shipped.
 *
 * app.js is imported once per process (ES modules are cached), so each case
 * runs in its own child process via `--case`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const posts = [];

function installGlobals() {
  const core = createRequire(import.meta.url)("survey-core");
  const mem = new Map();
  globalThis.Survey = core;
  globalThis.SurveyUI = { renderSurvey() {} };
  globalThis.document = { addEventListener() {}, getElementById: () => null };
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v),
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "flow-test" },
    configurable: true,
  });
  globalThis.window = {
    ELICITATION_CONFIG: {
      resultsEndpoint: "https://collector.test/exec",
      surveyVersion: "flow-test",
    },
    location: { search: "" },
    crypto: { randomUUID: () => "id-" + Math.random().toString(16).slice(2, 8) },
  };
  globalThis.fetch = async (_url, opts) => {
    posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  // console.log in app.js dumps the whole payload; keep test output readable.
  console.log = () => {};
  console.warn = () => {};
}

/** Loads the app as a participant arriving with this query string. */
async function loadApp(search = "") {
  window.location.search = search;
  const app = await import("../src/app.js");
  // Focusing an invalid question needs a DOM; without one it is a no-op.
  app.survey.getAllQuestions().forEach(q => { q.focus = () => false; });
  return app;
}
const ofMethod = (plan, method) => plan.main.filter(e => e.method === method);
const chipsFieldOn = (page) => page.questions.find(q => q.name.endsWith("_widget"))?.name.replace(/_widget$/, "");

/**
 * Answers whatever the current page still requires, then advances. Values
 * stay clear of 0 and 100 unless a case sets them, so no follow-up is
 * triggered by accident.
 */
function runToEnd(survey) {
  let guard = 0;
  while (!survey.isCompleted && guard++ < 300) {
    const page = survey.currentPage;
    if (!page) break;
    const chips = chipsFieldOn(page);
    if (chips && survey.getValue(chips) === undefined) survey.setValue(chips, [0, 0, 2, 4, 6, 4, 2, 2, 0, 0]);
    for (const q of page.questions) {
      const empty = q.value === undefined || q.value === null || q.value === "";
      if (!q.isRequired || !empty) continue;
      if (q.name === "consent") q.value = true;
      else if (q.getType() === "radiogroup") q.value = q.visibleChoices[0].value;
      else if (/_p10$/.test(q.name)) q.value = 20;
      else if (/_p50$/.test(q.name)) q.value = 40;
      else if (/_p90$/.test(q.name)) q.value = 65;
      else if (updateAnswer(survey, q.name) !== null) q.value = updateAnswer(survey, q.name);
      else q.value = 30;
    }
    const before = page.name;
    if (survey.isLastPage) survey.completeLastPage();
    else survey.nextPage();
    if (!survey.isCompleted && survey.currentPage?.name === before) {
      return { stuck: before };
    }
  }
  return { stuck: null };
}

/**
 * A coherent answer to a hypothetical Update result: halfway from the initial
 * expectation to the evidence rate (so every fit is valid). null if `name`
 * is not an Update answer.
 */
function updateAnswer(survey, name) {
  const m = name.match(/^(.*?)(_rare)?_updated(?:_successes)?(_2)?$/);
  if (!m) return null;
  const [, id, rare, second] = m;
  const evidence = survey.getValue(`${id}${rare || ""}_generated_x${second || ""}`);
  const prior = survey.getValue(rare ? `${id}_boundary_fine` : `${id}_prior_successes`);
  if (evidence === undefined || prior === undefined) return null;
  const scale = rare ? 10000 : 100;
  const n = rare ? 10000 : id === "practice" ? 100 : survey.getValue(`${id}_update_n`);
  return prior + 0.5 * (evidence * scale / n - prior);
}

// The collector rejects payloads with more fields than this, so every full
// response must stay under it. Read from Code.gs so the two cannot drift.
function collectorFieldLimit() {
  const src = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  return Number(src.match(/const MAX_FIELDS = (\d+);/)[1]);
}

const CASES = {
  async order() {
    const { surveyJson } = await loadApp();
    const names = surveyJson.pages.map(p => p.name);
    assert.equal(names[0], "consent", "consent comes before everything else");
    for (const p of ["practice_percentiles", "practice_chips", "practice_estimate", "practice_fit_check"]) {
      assert.ok(names.indexOf(p) > 0 && names.indexOf(p) < names.indexOf("training_done"), `${p} is in the training`);
    }
    assert.ok(names.indexOf("practice_percentiles") < names.indexOf("practice_chips"));
    assert.ok(names.indexOf("practice_chips") < names.indexOf("practice_estimate"));
    assert.equal(names[names.indexOf("training_done") + 1], "shared_context", "the main survey starts after training");
    assert.equal(names.at(-1), "final_comments");
    assert.ok(!JSON.stringify(surveyJson).includes("data-practice-explorer"), "the update-to-uncertainty explorer is gone");
  },

  async assignmentFromUrl() {
    const { survey, plan } = await loadApp("?variant=A");
    const { QUESTIONS } = await import("../src/questions.js");
    const methods = ["percentiles", "chips", "update", "percentiles", "chips", "update"];
    assert.equal(survey.getValue("survey_variant"), "A");
    assert.equal(survey.getValue("variant_source"), "url");
    QUESTIONS.forEach((q, i) => assert.equal(survey.getValue(`${q.id}_method`), methods[i], `Q${i + 1}`));
    const order = survey.getValue("question_order");
    assert.deepEqual(order, plan.main.map(e => e.id));
    order.forEach((id, i) => assert.equal(survey.getValue(`${id}_position`), i + 1));
    const ns = ofMethod(plan, "update").map(e => survey.getValue(`${e.id}_update_n`)).sort((a, b) => a - b);
    assert.deepEqual(ns, [20, 100]);
    assert.equal(survey.getValue("consistency_target"), ofMethod(plan, "percentiles")[0].id);
    assert.ok([100, 1000].includes(survey.getValue("diag_lowprob_denominator")));
    assert.equal(survey.getValue("main_plan").length, 6);
  },

  async assignmentRandom() {
    const { survey } = await loadApp("?variant=nope");
    assert.ok(["A", "B", "C"].includes(survey.getValue("survey_variant")));
    assert.equal(survey.getValue("variant_source"), "random");
  },

  async fullRunIsReconstructable() {
    const { survey, plan } = await loadApp("?variant=B");
    // Distinct ratings per question, to check each lands in its own column.
    plan.main.forEach((e, i) => survey.setValue(`${e.id}_format_rating`, (i % 5) + 1));
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts.length, 1);
    const p = posts[0];
    assert.equal(p.survey_variant, "B");
    assert.deepEqual(JSON.parse(p.question_order), plan.main.map(e => e.id));
    assert.deepEqual(JSON.parse(p.main_plan), plan.main.map(e => ({ id: e.id, method: e.method, n: e.updateN, position: e.position })));
    plan.main.forEach((e, i) => {
      const k = (base) => `${e.id}_${base}`;
      assert.equal(p[k("method")], e.method);
      assert.equal(p[k("position")], e.position);
      assert.equal(p[k("format_rating")], (i % 5) + 1, `${e.id}: rating in its own column`);
      // Every format went through the feedback page once, accepted first time.
      assert.equal(p[k("fit_feedback")], "about_right");
      assert.equal(p[k("fit_feedback_first")], "about_right");
      assert.equal(p[k("revision_count")], 0);
      assert.equal(p[k("edit_requests")], 0);
      const history = JSON.parse(p[k("revision_history")]);
      assert.equal(history.length, 1);
      assert.equal(history[0].action, "continue");
      assert.ok(k("original_fit_p10") in p && k("original_fit_p90") in p, `${e.id}: original fit kept`);
      if (e.method !== "update") {
        // Percentiles and Chips also carry a smooth approximation, beside the raw answers.
        const [f10, f50, f90] = ["fit_p10", "fit_p50", "fit_p90"].map(f => p[k(f)]);
        assert.equal(p[k("fit_valid")], true);
        assert.ok(f10 < f50 && f50 < f90, `${e.id}: ${f10} ${f50} ${f90}`);
        assert.ok(p[k("fit_alpha")] > 0 && p[k("fit_beta")] > 0);
      }
      if (e.method === "percentiles") {
        assert.deepEqual([p[k("p10")], p[k("p50")], p[k("p90")]], [20, 40, 65]);
        assert.ok(!(k("chips") in p) && !(k("prior_successes") in p), "only the assigned method's columns");
      }
      if (e.method === "chips") {
        assert.deepEqual(JSON.parse(p[k("chips")]), [0, 0, 2, 4, 6, 4, 2, 2, 0, 0]);
        assert.ok(!(k("p50") in p));
      }
      if (e.method === "update") {
        assert.equal(p[k("update_n")], e.updateN);
        assert.equal(p[k("prior_successes")], 30);
        assert.ok(!(k("generated_x_3") in p) && !(k("evidence_kinds") in p), "no third result, no old kinds");
        const evidence = JSON.parse(p[k("evidence")]);
        assert.deepEqual(evidence.map(r => r.direction).sort(), ["down", "up"]);
        evidence.forEach((r, i) => {
          assert.equal(r.n, e.updateN);
          assert.equal(p[k(i ? "generated_x_2" : "generated_x")], r.x, "presentation order kept");
          assert.equal(p[k(`${r.direction}_x`)], r.x);
          assert.equal(p[k(`${r.direction}_order`)], i + 1);
          assert.ok(Math.abs(p[k(`${r.direction}_updated`)] - (30 + 0.5 * (r.x * 100 / e.updateN - 30))) < 1e-9);
          assert.ok(Math.abs(p[k(`${r.direction}_w`)] - 0.5) < 1e-9, "fraction moved per result");
          assert.equal(p[k(`${r.direction}_class`)], "interior");
          for (const f of ["rate", "tail", "tail_mismatch", "nu"]) assert.ok(Number.isFinite(p[k(`${r.direction}_${f}`)]), `${r.direction}_${f}`);
        });
        assert.ok(p[k("up_x")] / e.updateN > 0.3 && p[k("down_x")] / e.updateN < 0.3, "one above, one below the expectation");
        assert.ok(Math.abs(p[k("fit_w")] - 0.5) < 1e-9);
        assert.equal(p[k("fit_valid")], true);
        assert.equal(JSON.parse(p[k("fit_diagnostics")]).n, e.updateN);
        for (const f of ["fit_alpha", "fit_beta", "fit_nu", "credible_interval_90", "credible_interval_50"]) assert.ok(k(f) in p, k(f));
        // The fit's own percentiles, out of 100, for comparison with Percentiles.
        const [f10, f50, f90] = ["fit_p10", "fit_p50", "fit_p90"].map(f => p[k(f)]);
        assert.ok(f10 < f50 && f50 < f90 && f10 >= 0 && f90 <= 100, `${f10} ${f50} ${f90}`);
        assert.ok(!(k("width_check") in p), "main Update uses the shared feedback question");
      }
    });
    // Standalone items and the delayed repeat.
    assert.equal(p.consistency_target, ofMethod(plan, "percentiles")[0].id);
    assert.equal(p.consistency_repeat_estimate, 30);
    assert.equal(p.diag_bayes_estimate, 30);
    assert.equal(p.diag_chain_estimate, 30);
    assert.equal(p.diag_lowprob_answer, 30);
    assert.equal(p.diag_lowprob_probability, 30 / p.diag_lowprob_denominator);
    // Training answers are kept, under their own prefix.
    for (const key of ["practice_p50", "practice_chips", "practice_prior_successes", "practice_updated_successes_2"]) assert.ok(key in p, key);
    assert.ok(!("practice_updated_successes_3" in p));
    // Still anonymous, and within what the collector accepts.
    for (const key of ["participant_name", "user_agent", "submitted_at", "started_at"]) assert.ok(!(key in p), key);
    assert.ok(Object.keys(p).length <= collectorFieldLimit(), `payload has ${Object.keys(p).length} fields`);
    console.error(`PAYLOAD_FIELDS=${Object.keys(p).length}`);
  },

  async trainingFeedbackFitsKeepRawAnswers() {
    const { survey } = await loadApp("?variant=A");
    survey.setValue("practice_p10", 20);
    survey.setValue("practice_p50", 40);
    assert.equal(survey.getValue("practice_percentiles_fit_valid"), undefined, "no fit from two of three answers");
    survey.setValue("practice_p90", 65);
    assert.equal(survey.getValue("practice_percentiles_fit_valid"), true);
    assert.ok(Math.abs(survey.getValue("practice_percentiles_fit_p50") - 40) < 2);
    assert.deepEqual(["practice_p10", "practice_p50", "practice_p90"].map(k => survey.getValue(k)), [20, 40, 65], "raw answers untouched");
    const chips = [0, 1, 3, 6, 5, 3, 2, 0, 0, 0];
    survey.setValue("practice_chips", chips);
    assert.equal(survey.getValue("practice_chips_fit_valid"), true);
    assert.deepEqual(survey.getValue("practice_chips"), chips, "chip counts untouched");
    survey.setValue("practice_chips", [1, 1]);
    assert.equal(survey.getValue("practice_chips_fit_valid"), undefined, "a partial allocation clears the fit");
    // Changing an answer refits; out of order clears.
    survey.setValue("practice_p90", 30);
    assert.equal(survey.getValue("practice_percentiles_fit_p10"), undefined);
  },
  async percentilesMustBeInOrder() {
    const { survey, plan } = await loadApp("?variant=A");
    for (const prefix of ["practice", ofMethod(plan, "percentiles")[0].id]) {
      const page = prefix === "practice" ? "practice_percentiles" : `${prefix}_percentiles`;
      survey.currentPage = survey.getPageByName(page);
      survey.setValue(`${prefix}_p10`, 40);
      survey.setValue(`${prefix}_p50`, 30);
      survey.setValue(`${prefix}_p90`, 60);
      survey.nextPage();
      assert.equal(survey.currentPage.name, page, "p50 below p10 is refused");
      survey.setValue(`${prefix}_p50`, 50);
      survey.setValue(`${prefix}_p90`, 45);
      survey.nextPage();
      assert.equal(survey.currentPage.name, page, "p90 below p50 is refused");
      survey.setValue(`${prefix}_p90`, 50);
      survey.nextPage();
      assert.notEqual(survey.currentPage.name, page, "p10 <= p50 <= p90 (ties allowed) goes through");
    }
  },

  async chipsNeedExactly20() {
    const { survey, plan } = await loadApp("?variant=A");
    for (const field of ["practice_chips", ofMethod(plan, "chips")[0].id + "_chips"]) {
      const page = field === "practice_chips" ? "practice_chips" : field;
      survey.currentPage = survey.getPageByName(page);
      survey.nextPage();
      assert.equal(survey.currentPage.name, page, "no chips: cannot continue");
      survey.setValue(field, [2, 2, 2, 2, 2, 2, 2, 2, 2, 0]);
      survey.nextPage();
      assert.equal(survey.currentPage.name, page, "19 chips: cannot continue");
      survey.setValue(field, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
      survey.nextPage();
      assert.notEqual(survey.currentPage.name, page, "20 chips: continues");
    }
    // Going back is never blocked.
    survey.currentPage = survey.getPageByName("practice_chips");
    survey.setValue("practice_chips", [1]);
    survey.prevPage();
    assert.equal(survey.currentPage.name, "practice_percentiles_feedback");
  },

  async updateEvidenceUsesAssignedN() {
    const { survey, plan } = await loadApp("?variant=C");
    for (const e of ofMethod(plan, "update")) {
      survey.setValue(`${e.id}_prior_successes`, 30);
      const xs = ["", "_2"].map(s => survey.getValue(`${e.id}_generated_x${s}`));
      assert.ok(xs.every(x => Number.isInteger(x) && x >= 0 && x <= e.updateN), `${e.updateN}: ${xs}`);
      assert.equal(survey.getValue(`${e.id}_generated_x_3`), undefined, "two results only");
      assert.ok(survey.getValue(`${e.id}_evidence`).every(r => r.n === e.updateN), "both use the question's n");
      const html = survey.getQuestionByName(`${e.id}_update_context`).processedHtml;
      assert.match(html, new RegExp(`successes out of ${e.updateN}</strong>`), "the page shows the evidence out of n");
      assert.match(html, /30 out of 100<\/strong>/, "the estimate stays out of 100");
      const title = survey.getQuestionByName(`${e.id}_updated_successes`).processedTitle;
      assert.match(title, /out of the next 100 comparable attempts/);
    }
  },

  async boundaryOnPercentileMedian() {
    const { survey, plan } = await loadApp("?variant=A");
    const id = ofMethod(plan, "percentiles")[0].id;
    survey.setValue(`${id}_p10`, 0);
    survey.setValue(`${id}_p50`, 0);
    survey.setValue(`${id}_p90`, 2);
    assert.ok(survey.getPageByName(`${id}_boundary`).isVisible);
    const q = survey.getQuestionByName(`${id}_boundary_meaning`);
    assert.equal(q.processedTitle, "Do you mean that you think this outcome is impossible, or merely very rare?");
    assert.deepEqual(q.visibleChoices.map(c => c.value), ["impossible", "very_rare"]);
    survey.setValue(`${id}_boundary_meaning`, "very_rare");
    assert.ok(survey.getPageByName(`${id}_boundary_scale`).isVisible);
    assert.match(survey.getQuestionByName(`${id}_boundary_fine`).processedTitle, /Out of 10,000 comparable attempts, in how many do you expect that the agent succeeds\?/);
    survey.setValue(`${id}_boundary_fine`, 3);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    const p = posts[0];
    assert.equal(p[`${id}_p50`], 0, "the original answer is kept");
    assert.equal(p[`${id}_boundary_meaning`], "very_rare");
    assert.equal(p[`${id}_boundary_fine`], 3);
    assert.equal(p[`${id}_boundary_fine_counts`], "successes");
  },

  async boundaryOnUpdateAt100() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    const visible = () => survey.visiblePages.map(pg => pg.name).filter(n => n.startsWith(`${e.id}_`));
    survey.setValue(k("prior_successes"), 100);
    const q = survey.getQuestionByName(k("boundary_meaning"));
    assert.equal(q.processedTitle, "Do you mean that you think this outcome is certain, or extremely likely but not certain?");
    assert.deepEqual(q.visibleChoices.map(c => c.value), ["certain", "not_certain"]);
    assert.equal(survey.getValue(k("generated_x")), undefined, "no evidence for the skipped updates");
    survey.setValue(k("boundary_meaning"), "certain");
    assert.deepEqual(visible(), [k("estimate"), k("boundary"), k("rating")], "certain goes straight on");
    survey.setValue(k("boundary_meaning"), "not_certain");
    assert.equal(survey.getValue(k("boundary_fine_counts")), "failures");
    assert.match(survey.getQuestionByName(k("boundary_fine")).processedTitle, /the agent fails\?/);
    survey.setValue(k("boundary_fine"), 4);
    const xs = ["", "_2"].map(s => survey.getValue(k(`rare_generated_x${s}`)));
    assert.ok(xs.every(x => Number.isInteger(x) && x <= 10000), String(xs));
    assert.ok(Math.min(...xs) < 4 && Math.max(...xs) > 4, "one result each side of the fine estimate");
    assert.match(survey.getQuestionByName(k("rare_updated")).processedTitle, /out of the next 10,000 comparable attempts, in how many would you expect the agent to fail\?/);
    ["rare_updated", "rare_updated_2"].forEach(f => survey.setValue(k(f), updateAnswer(survey, k(f))));
    assert.equal(survey.getValue(k("rare_fit_valid")), true);
    assert.deepEqual(visible(), [k("estimate"), k("boundary"), k("boundary_scale"), k("rare_update"), k("rare_update_2"),
      k("rare_fit_check"), k("rating")]);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    const p = posts[0];
    assert.equal(p[k("prior_successes")], 100, "the original answer is kept");
    assert.equal(p[k("boundary_meaning")], "not_certain");
    assert.equal(p[k("boundary_fine")], 4);
    assert.equal(p[k("fit_invalid_reason")], "boundary_mean");
    assert.equal(p[k("rare_fit_valid")], true);
  },

  async changingAnAnswerClearsItsFollowUp() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    survey.setValue(k("prior_successes"), 0);
    survey.setValue(k("boundary_meaning"), "very_rare");
    survey.setValue(k("boundary_fine"), 5);
    survey.setValue(k("rare_updated"), 4);
    survey.setValue(k("boundary_meaning"), "impossible");
    assert.equal(survey.getValue(k("boundary_fine")), undefined);
    assert.equal(survey.getValue(k("rare_updated")), undefined);
    survey.setValue(k("boundary_meaning"), "very_rare");
    survey.setValue(k("boundary_fine"), 5);
    survey.setValue(k("prior_successes"), 30);
    assert.equal(survey.getValue(k("boundary_meaning")), undefined);
    assert.ok(survey.getPageByName(k("update")).isVisible, "the usual updates are back");
    assert.ok(Number.isInteger(survey.getValue(k("generated_x"))));
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(!Object.keys(posts[0]).some(key => key.startsWith(k("rare_")) || key.startsWith(k("boundary_"))),
      "nothing from the abandoned follow-up is sent");
  },

  async consistencyRepeatAndDiagnostics() {
    const { survey, plan } = await loadApp("?variant=C");
    const target = plan.consistencyTarget;
    const page = survey.getPageByName("consistency_repeat");
    assert.ok(page.questions.some(q => q.name === "consistency_repeat_scenario"));
    assert.ok(!JSON.stringify(page.toJSON()).includes(`${target}_p50`), "the earlier answer is not shown");
    survey.setValue("consistency_repeat_estimate", 0);
    survey.setValue("consistency_repeat_boundary_meaning", "impossible");
    // Low-probability item: normalised, and 0 gets the follow-up too.
    const denominator = survey.getValue("diag_lowprob_denominator");
    assert.match(survey.getQuestionByName("diag_lowprob_answer").processedTitle, new RegExp(`^Imagine ${denominator.toLocaleString("en-US")} adults in the UK`));
    survey.setValue("diag_lowprob_answer", 0);
    assert.ok(survey.getPageByName("diag_lowprob_boundary").isVisible);
    survey.setValue("diag_lowprob_boundary_meaning", "very_rare");
    survey.setValue("diag_lowprob_boundary_fine", 2);
    survey.setValue("diag_bayes_estimate", 31);
    survey.setValue("diag_chain_estimate", 59);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    const p = posts[0];
    assert.equal(p.consistency_target, target);
    assert.equal(p.consistency_repeat_estimate, 0);
    assert.equal(p.consistency_repeat_boundary_meaning, "impossible");
    assert.equal(p.diag_lowprob_answer, 0);
    assert.equal(p.diag_lowprob_probability, 0);
    assert.equal(p.diag_lowprob_boundary_fine, 2);
    assert.equal(p.diag_lowprob_boundary_fine_counts, "occurrences");
    assert.equal(p.diag_bayes_estimate, 31);
    assert.equal(p.diag_chain_estimate, 59);
  },

  async lowProbWordingInBothConditions() {
    // Built for each denominator directly, so both conditions are checked every run.
    const { buildMainSection } = await import("../src/pages/main.js");
    const { assignParticipant } = await import("../src/assignment.js");
    const { QUESTIONS } = await import("../src/questions.js");
    const base = assignParticipant(QUESTIONS, { variant: "A", rng: () => 0.3 });
    const text = {};
    for (const d of [100, 1000]) {
      const pages = buildMainSection({ ...base, lowProbDenominator: d }).pages;
      const page = (name) => pages.find(pg => pg.name === name);
      const q = page("diag_lowprob").elements.find(el => el.name === "diag_lowprob_answer");
      const meaning = page("diag_lowprob_boundary").elements.find(el => el.name === "diag_lowprob_boundary_meaning");
      const fine = page("diag_lowprob_boundary_scale").elements.find(el => el.name === "diag_lowprob_boundary_fine");
      const shown = d.toLocaleString("en-US");
      assert.equal(q.title, `Imagine ${shown} adults in the UK were selected at random. About how many would you expect to have donated blood at least once in the past 12 months?`);
      assert.equal(q.max, d);
      assert.equal(meaning.title, "You answered 0. Which is closer to what you mean?");
      assert.deepEqual(meaning.choices.map(c => [c.value, c.text]), [
        ["effectively_zero", "I think the true rate could effectively be zero."],
        ["very_rare", `I think some people do this, but the expected number is smaller than 1 in ${shown}.`],
      ]);
      assert.equal(fine.title, "Out of 10,000 randomly selected adults in the UK, about how many would you expect to have donated blood at least once in the past 12 months?");
      // Zero only: no follow-up at the top of the scale.
      assert.equal(page("diag_lowprob_boundary").visibleIf, "{diag_lowprob_answer} = 0");
      // No hints, benchmarks or feedback anywhere in the item.
      const all = JSON.stringify(["diag_lowprob", "diag_lowprob_boundary", "diag_lowprob_boundary_scale"].map(page));
      assert.doesNotMatch(all, /rare(ly)? (event|activity)|benchmark|correct|true answer|actual(ly)?|%/i);
      text[d] = q.title.replace(shown, "N");
    }
    assert.equal(text[100], text[1000], "the two conditions differ only in the denominator");
  },

  async chainedStepsTakeWholeNumbers() {
    const { survey } = await loadApp("?variant=A");
    const q = survey.getQuestionByName("diag_chain_estimate");
    assert.equal(q.description, "Enter a whole number from 0 to 100.");
    survey.currentPage = survey.getPageByName("diag_chain");
    survey.setValue("diag_chain_estimate", 59.05);
    survey.nextPage();
    assert.equal(survey.currentPage.name, "diag_chain", "a decimal is refused");
    survey.setValue("diag_chain_estimate", 59);
    survey.nextPage();
    assert.notEqual(survey.currentPage.name, "diag_chain", "a whole number continues");
    // The Bayesian item still takes decimals.
    assert.match(survey.getQuestionByName("diag_bayes_estimate").description, /Decimals are welcome/);
  },

  async lowProbZeroFollowUp() {
    const { survey, plan } = await loadApp("?variant=A");
    const d = plan.lowProbDenominator;
    assert.equal(survey.getValue("diag_lowprob_denominator"), d, "the assigned denominator is stored");
    const followUp = () => survey.getPageByName("diag_lowprob_boundary");
    const fine = () => survey.getPageByName("diag_lowprob_boundary_scale");
    // A non-zero answer skips the follow-up.
    survey.setValue("diag_lowprob_answer", 3);
    assert.ok(!followUp().isVisible && !fine().isVisible);
    assert.equal(survey.getValue("diag_lowprob_probability"), 3 / d);
    // The top of the scale gets no follow-up either.
    survey.setValue("diag_lowprob_answer", d);
    assert.ok(!followUp().isVisible);
    // Zero does.
    survey.setValue("diag_lowprob_answer", 0);
    assert.ok(followUp().isVisible);
    const q = survey.getQuestionByName("diag_lowprob_boundary_meaning");
    assert.match(q.visibleChoices[1].text, new RegExp(`smaller than 1 in ${d.toLocaleString("en-US")}\\.$`));
    survey.setValue("diag_lowprob_boundary_meaning", "effectively_zero");
    assert.ok(!fine().isVisible, "effectively zero: no finer scale");
    survey.setValue("diag_lowprob_boundary_meaning", "very_rare");
    assert.ok(fine().isVisible, "some people do: the out-of-10,000 question");
    survey.setValue("diag_lowprob_boundary_fine", 4);
    survey.setValue("diag_bayes_estimate", 30);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    const p = posts[0];
    assert.equal(p.diag_lowprob_answer, 0, "the original 0 is kept as given");
    assert.equal(p.diag_lowprob_probability, 0);
    assert.equal(p.diag_lowprob_boundary_meaning, "very_rare");
    assert.equal(p.diag_lowprob_boundary_fine, 4, "the finer estimate is stored separately");
    assert.equal(p.diag_lowprob_denominator, d);
  },

  async lowProbChangingTheAnswerClearsTheFollowUp() {
    const { survey } = await loadApp("?variant=A");
    survey.setValue("diag_lowprob_answer", 0);
    survey.setValue("diag_lowprob_boundary_meaning", "very_rare");
    survey.setValue("diag_lowprob_boundary_fine", 4);
    survey.setValue("diag_lowprob_answer", 2);
    assert.equal(survey.getValue("diag_lowprob_boundary_meaning"), undefined);
    assert.equal(survey.getValue("diag_lowprob_boundary_fine"), undefined);
  },

  async backButtonOnUpdate() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    survey.currentPage = survey.getPageByName(k("estimate"));
    survey.setValue(k("prior_successes"), 30);
    const evidence = ["", "_2"].map(s => survey.getValue(k(`generated_x${s}`)));
    ["updated_successes", "updated_successes_2"].forEach(f => survey.setValue(k(f), updateAnswer(survey, k(f))));
    survey.currentPage = survey.getPageByName(k("feedback"));
    survey.setValue(k("fit_feedback"), "too_wide");
    survey.prevPage();
    assert.equal(survey.currentPage.name, k("update_2"));
    survey.nextPage();
    assert.equal(survey.getValue(k("fit_feedback")), "too_wide", "just looking back changes nothing");
    assert.equal(survey.getValue(k("revision_count")), 0);
    assert.deepEqual(["", "_2"].map(s => survey.getValue(k(`generated_x${s}`))), evidence);
    // A change made via Back counts as a revision, and the old verdict goes.
    survey.prevPage();
    survey.setValue(k("updated_successes_2"), survey.getValue(k("updated_successes_2")) + 1);
    survey.nextPage();
    assert.equal(survey.getValue(k("revision_count")), 1);
    assert.equal(survey.getValue(k("fit_feedback")), undefined, "a verdict on an old curve must not survive");
    survey.setValue(k("prior_successes"), 70);
    assert.equal(survey.getValue(k("updated_successes")), undefined);
    assert.equal(survey.getValue(k("fit_alpha")), undefined, "no stale fit after a new estimate");
  },

  async revisionLoopPercentiles() {
    const { survey, plan, requestEdit } = await loadApp("?variant=A");
    const id = plan.consistencyTarget; // the first Percentiles question shown
    const k = (base) => `${id}_${base}`;
    const nav = (id) => survey.navigationBar.getActionById(id);
    survey.currentPage = survey.getPageByName(k("percentiles"));
    [20, 40, 65].forEach((v, i) => survey.setValue(k(["p10", "p50", "p90"][i]), v));
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"), "the answer is followed by its fitted curve");
    assert.equal(survey.getValue(k("revision_count")), 0);
    assert.deepEqual(["original_p10", "original_p50", "original_p90"].map(f => survey.getValue(k(f))), [20, 40, 65]);
    const firstFitP90 = survey.getValue(k("original_fit_p90"));
    assert.ok(Number.isFinite(firstFitP90));
    // About right: the usual Continue. Anything else: Edit my answer takes
    // Continue's place, with "Continue without changes" to its right.
    survey.setValue(k("fit_feedback"), "about_right");
    assert.ok(!nav("nav-edit").visible);
    assert.equal(nav("sv-nav-next").title, "Continue");
    for (const v of ["too_narrow", "too_wide", "centre_wrong", "other"]) {
      survey.setValue(k("fit_feedback"), v);
      assert.ok(nav("nav-edit").visible, `${v} offers Edit my answer`);
      assert.equal(nav("sv-nav-next").title, "Continue without changes");
      assert.ok(nav("nav-edit").visibleIndex < nav("sv-nav-next").visibleIndex, "Edit first, where Continue usually is");
      assert.match(nav("nav-edit").innerCss, /sd-navigation__next-btn/, "Edit has the main-button style");
      assert.doesNotMatch(nav("sv-nav-next").innerCss, /sd-navigation__next-btn/, "Continue is the plain one");
    }
    survey.setValue(k("fit_feedback"), "too_wide");
    nav("nav-edit").action(); // the navigation-bar button itself
    assert.equal(survey.currentPage.name, k("percentiles"), "Edit goes back to the same question");
    assert.ok(!nav("nav-edit").visible, "and the usual Continue is back on the question page");
    assert.equal(nav("sv-nav-next").title, "Continue");
    assert.equal(survey.getValue(k("p10")), 20, "with the answer still filled in");
    assert.equal(survey.getValue(k("edit_requests")), 1);
    // First revision.
    survey.setValue(k("p10"), 30);
    survey.setValue(k("p90"), 55);
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"));
    assert.equal(survey.getValue(k("revision_count")), 1);
    assert.equal(survey.getValue(k("fit_feedback")), undefined, "the new curve is judged afresh");
    assert.ok(survey.getValue(k("fit_p90")) < firstFitP90, "the revised answer is refitted");
    // Second revision.
    survey.setValue(k("fit_feedback"), "too_narrow");
    requestEdit(id);
    survey.setValue(k("p50"), 45);
    survey.setValue(k("p90"), 60);
    survey.nextPage();
    assert.equal(survey.getValue(k("revision_count")), 2);
    survey.setValue(k("fit_feedback"), "about_right");
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("rating"), "accepted: on to the rating");
    const history = survey.getValue(k("revision_history"));
    assert.deepEqual(history.map(h => [h.action, h.judgment]), [["edit", "too_wide"], ["edit", "too_narrow"], ["continue", "about_right"]]);
    assert.deepEqual(history[0].answer, { p10: 20, p50: 40, p90: 65 });
    assert.deepEqual(history[2].answer, { p10: 30, p50: 45, p90: 60 });
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    const p = posts[0];
    assert.deepEqual([p[k("p10")], p[k("p50")], p[k("p90")]], [30, 45, 60], "final answer in the usual columns");
    assert.deepEqual([p[k("original_p10")], p[k("original_p50")], p[k("original_p90")]], [20, 40, 65], "original kept");
    assert.equal(p[k("fit_feedback_first")], "too_wide");
    assert.equal(p[k("fit_feedback")], "about_right");
    assert.equal(p[k("revision_count")], 2);
    assert.equal(p[k("edit_requests")], 2);
    assert.equal(JSON.parse(p[k("revision_history")]).length, 3);
    // The consistency repeat compares with the final median; the original is kept.
    assert.equal(p.consistency_target, id);
    assert.equal(p.consistency_target_p50, 45);
    assert.equal(p.consistency_target_p50_original, 40);
    assert.ok(Number.isInteger(p[k("format_rating")]), "rated once, after the loop");
  },

  async revisionLoopChips() {
    const { survey, plan, requestEdit } = await loadApp("?variant=A");
    const id = ofMethod(plan, "chips")[0].id;
    const k = (base) => `${id}_${base}`;
    const first = [0, 0, 2, 4, 6, 4, 2, 2, 0, 0];
    survey.currentPage = survey.getPageByName(k("chips"));
    survey.setValue(k("chips"), first);
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"));
    assert.equal(survey.getValue(k("fit_valid")), true);
    survey.setValue(k("fit_feedback"), "other");
    assert.ok(survey.getQuestionByName(k("fit_feedback_other")).isVisible);
    survey.setValue(k("fit_feedback_other"), "I meant two separate peaks");
    requestEdit(id);
    assert.equal(survey.currentPage.name, k("chips"));
    assert.deepEqual(survey.getValue(k("chips")), first, "chips still placed");
    const second = [3, 3, 2, 1, 1, 1, 1, 2, 3, 3];
    survey.setValue(k("chips"), second);
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"));
    assert.equal(survey.getValue(k("revision_count")), 1);
    survey.setValue(k("fit_feedback"), "about_right");
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("rating"));
    runToEnd(survey);
    const p = posts[0];
    assert.deepEqual(JSON.parse(p[k("original_chips")]), first);
    assert.deepEqual(JSON.parse(p[k("chips")]), second);
    assert.equal(p[k("fit_feedback_first")], "other");
    assert.equal(p[k("fit_feedback_first_other")], "I meant two separate peaks");
    assert.ok(p[k("original_fit_p50")] !== p[k("fit_p50")], "original and final fits both kept");
  },

  async revisionLoopUpdate() {
    const { survey, plan, requestEdit } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    survey.currentPage = survey.getPageByName(k("estimate"));
    survey.setValue(k("prior_successes"), 30);
    ["updated_successes", "updated_successes_2"].forEach(f => survey.setValue(k(f), updateAnswer(survey, k(f))));
    const first = survey.getValue(k("updated_successes_2"));
    for (let i = 0; i < 3; i++) survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"), "estimate, two results, then feedback");
    assert.equal(survey.getValue(k("fit_valid")), true);
    assert.equal(JSON.parse(JSON.stringify(survey.getValue(k("original_evidence")))).length, 2, "the original evidence is kept");
    survey.setValue(k("fit_feedback"), "centre_wrong");
    requestEdit(e.id);
    assert.equal(survey.currentPage.name, k("estimate"));
    assert.equal(survey.getValue(k("prior_successes")), 30);
    // A smaller move on the second result: still coherent, so it refits.
    const x2 = survey.getValue(k("generated_x_2")) * 100 / e.updateN;
    const revised = 30 + 0.2 * (x2 - 30);
    survey.setValue(k("updated_successes_2"), revised);
    for (let i = 0; i < 3; i++) survey.nextPage();
    assert.equal(survey.currentPage.name, k("feedback"));
    assert.equal(survey.getValue(k("revision_count")), 1);
    assert.equal(survey.getValue(k("fit_valid")), true, "refitted");
    survey.setValue(k("fit_feedback"), "about_right");
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("rating"));
    runToEnd(survey);
    const p = posts[0];
    assert.equal(p[k("original_updated_successes_2")], first);
    assert.equal(p[k("updated_successes_2")], revised);
    assert.equal(p[k("fit_feedback_first")], "centre_wrong");
  },

  async updatePagesWordingAndIndependence() {
    const { survey, plan } = await loadApp("?variant=A");
    for (const e of ofMethod(plan, "update")) {
      const k = (base) => `${e.id}_${base}`;
      survey.setValue(k("prior_successes"), 50);
      // Answering the first result does not change what the second starts from.
      survey.setValue(k("updated_successes"), 60);
      for (const [i, s] of [["", ""], ["_2", "_2"]]) {
        const html = survey.getQuestionByName(k(`update${s}_context`)).processedHtml;
        assert.match(html, /Imagine this result only\./);
        assert.match(html, /Start from your original view and set aside the other hypothetical result\./);
        assert.match(html, /<strong>50 out of 100<\/strong>/, "the original estimate, not the previous answer");
        assert.match(html, new RegExp(`<strong>${survey.getValue(k(`generated_x${i}`))} successes out of ${e.updateN}</strong>`));
        assert.match(html, /These trials use the same agent, hardware, task, and conditions\. Assume the recorded outcomes are accurate, the trials are independent, and there were no unusual technical problems\./);
        assert.doesNotMatch(html, /representative/i);
        assert.equal(survey.getQuestionByName(k(`updated_successes${s}`)).processedTitle,
          "If you saw only this result, out of the next 100 comparable attempts, in how many would you expect the agent to succeed?");
      }
      assert.ok(!survey.getPageByName(k("update_3")), "only two results");
      const xs = [survey.getValue(k("generated_x")), survey.getValue(k("generated_x_2"))].sort((a, b) => a - b);
      assert.deepEqual(xs, e.updateN === 20 ? [6, 14] : [42, 58], `n = ${e.updateN} at 50%`);
    }
  },

  async incoherentUpdatesShowNoCurveButCanContinue() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    const nav = (id) => survey.navigationBar.getActionById(id);
    for (const [label, factor, reason] of [["moved away", -0.5, "moved_away"], ["overshoot", 1.5, "overshoot"]]) {
      survey.setValue(k("prior_successes"), 40);
      const x1 = survey.getValue(k("generated_x")) * 100 / e.updateN;
      const x2 = survey.getValue(k("generated_x_2")) * 100 / e.updateN;
      survey.setValue(k("updated_successes"), 40 + factor * (x1 - 40));
      survey.setValue(k("updated_successes_2"), 40 + 0.5 * (x2 - 40));
      assert.equal(survey.getValue(k("fit_valid")), false, label);
      assert.equal(survey.getValue(k("fit_invalid_reason")), reason);
      assert.equal(survey.getValue(k("fit_alpha")), undefined, `${label}: no clamped curve`);
      const dir = survey.getValue(k("evidence"))[0].direction;
      assert.equal(survey.getValue(k(`${dir}_class`)), reason, "classified, raw answer kept");
      survey.currentPage = survey.getPageByName(k("feedback"));
      assert.ok(!survey.getQuestionByName(k("fit_feedback")).isVisible, "nothing to judge");
      assert.ok(nav("nav-edit").visible, "Edit my answer offered");
      assert.equal(nav("sv-nav-next").title, "Continue anyway");
      survey.prevPage();
    }
    survey.currentPage = survey.getPageByName(k("feedback"));
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("rating"), "Continue anyway works, with answers required");
  },

  async updateTrainingMatchesTheMainFormat() {
    const { survey, surveyJson } = await loadApp();
    const names = surveyJson.pages.map(pg => pg.name);
    const start = names.indexOf("practice_estimate");
    assert.deepEqual(names.slice(start, start + 4), ["practice_estimate", "practice_update", "practice_update_2", "practice_fit_check"]);
    survey.setValue("practice_prior_successes", 50);
    const dirs = survey.getValue("practice_evidence").map(r => r.direction).sort();
    assert.deepEqual(dirs, ["down", "up"]);
    // An incoherent practice answer still gets the page, with a neutral note.
    survey.setValue("practice_updated_successes", 50);
    survey.setValue("practice_updated_successes_2", 50);
    assert.equal(survey.getValue("practice_fit_valid"), false);
    assert.ok(survey.getPageByName("practice_fit_check").isVisible);
    assert.ok(!survey.getQuestionByName("practice_width_check").isVisible);
    const text = JSON.stringify(surveyJson.pages.find(pg => pg.name === "practice_update_intro"));
    assert.match(text, /two hypothetical evaluation results/);
    assert.match(text, /no target amount you should move/);
    assert.doesNotMatch(text, /representative|three/i);
  },

  async fitFailureStillContinues() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    // An estimate but no updates: nothing can be fitted.
    survey.setValue(k("prior_successes"), 30);
    survey.currentPage = survey.getPageByName(k("feedback"));
    assert.notEqual(survey.getValue(k("fit_valid")), true);
    assert.ok(!survey.getQuestionByName(k("fit_feedback")).isVisible, "no curve, so nothing to judge");
    assert.ok(survey.navigationBar.getActionById("nav-edit").visible, "editing is still offered");
    assert.equal(survey.navigationBar.getActionById("sv-nav-next").title, "Continue anyway");
    survey.nextPage();
    assert.equal(survey.currentPage.name, k("rating"), "and Continue still works, with answers required");
    assert.equal(JSON.parse(JSON.stringify(survey.getValue(k("revision_history"))))[0].fit.valid, false);
  },

  async consentGate() {
    const { survey } = await loadApp();
    assert.equal(survey.currentPage.name, "consent");
    survey.nextPage();
    assert.equal(survey.currentPage.name, "consent", "cannot start without consenting");
    survey.setValue("consent", false);
    survey.nextPage();
    assert.equal(survey.currentPage.name, "consent", "an unticked box is not consent");
    survey.setValue("consent", true);
    survey.nextPage();
    assert.equal(survey.currentPage.name, "training_intro");
    assert.equal(runToEnd(survey).stuck, null);
    assert.equal(posts.at(-1).consent, true);
    assert.equal(posts.at(-1).answers_required, true);
  },

  async optionalAnswers() {
    window.ELICITATION_CONFIG.requireAnswers = false;
    const { survey } = await loadApp();
    survey.nextPage();
    assert.equal(survey.currentPage.name, "consent", "consent is still required");
    survey.setValue("consent", true);
    // Everything else can be skipped, straight through to Finish -- including
    // untouched chips.
    let guard = 0;
    while (!survey.isLastPage && guard++ < 300) {
      const before = survey.currentPage.name;
      survey.nextPage();
      assert.notEqual(survey.currentPage.name, before, `stuck on ${before}`);
    }
    survey.completeLastPage();
    assert.ok(survey.isCompleted);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(posts.at(-1).answers_required, false, "skippable responses are labelled as such");
  },

  async optionalAnswersStillRefusePartialChips() {
    window.ELICITATION_CONFIG.requireAnswers = false;
    const { survey } = await loadApp();
    survey.currentPage = survey.getPageByName("practice_chips");
    survey.setValue("practice_chips", [5]);
    survey.nextPage();
    assert.equal(survey.currentPage.name, "practice_chips");
  },
};

const arg = process.argv.indexOf("--case");
if (arg !== -1) {
  installGlobals();
  const name = process.argv[arg + 1];
  await CASES[name]();
  process.exit(0);
}

let pass = 0, fail = 0;
for (const name of Object.keys(CASES)) {
  const r = spawnSync(process.execPath, [HERE + "flow.mjs", "--case", name], {
    encoding: "utf8",
  });
  if (r.status === 0) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    const msg = (r.stderr || "").split("\n").find((l) => /Error|assert/i.test(l)) || r.stderr;
    console.log(`  FAIL  ${name}\n        ${(msg || "").trim().slice(0, 300)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

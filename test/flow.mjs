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
        for (const s of ["", "_2", "_3"]) {
          const x = p[k("generated_x" + s)];
          assert.ok(Number.isInteger(x) && x >= 0 && x <= e.updateN, `${e.id}: evidence ${x} out of ${e.updateN}`);
          assert.equal(p[k("updated_successes" + s)], 30);
        }
        assert.deepEqual(JSON.parse(p[k("evidence_kinds")]).sort(), ["extreme", "jump", "middle"]);
        assert.equal(JSON.parse(p[k("evidence_tails")]).length, 3);
        assert.equal(p[k("fit_valid")], true);
        assert.equal(JSON.parse(p[k("fit_diagnostics")]).n, e.updateN);
        for (const f of ["fit_alpha", "fit_beta", "fit_nu", "credible_interval_90", "credible_interval_50"]) assert.ok(k(f) in p, k(f));
        // The fit's own percentiles, out of 100, for comparison with Percentiles.
        const [f10, f50, f90] = ["fit_p10", "fit_p50", "fit_p90"].map(f => p[k(f)]);
        assert.ok(f10 < f50 && f50 < f90 && f10 >= 0 && f90 <= 100, `${f10} ${f50} ${f90}`);
        assert.ok(k("width_check") in p);
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
    for (const key of ["practice_p50", "practice_chips", "practice_prior_successes", "practice_updated_successes_3"]) assert.ok(key in p, key);
    // Still anonymous, and within what the collector accepts.
    for (const key of ["participant_name", "user_agent", "submitted_at", "started_at"]) assert.ok(!(key in p), key);
    assert.ok(Object.keys(p).length <= collectorFieldLimit(), `payload has ${Object.keys(p).length} fields`);
    console.error(`PAYLOAD_FIELDS=${Object.keys(p).length}`);
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
      const xs = ["", "_2", "_3"].map(s => survey.getValue(`${e.id}_generated_x${s}`));
      assert.ok(xs.every(x => Number.isInteger(x) && x >= 0 && x <= e.updateN), `${e.updateN}: ${xs}`);
      const html = survey.getQuestionByName(`${e.id}_update_context`).processedHtml;
      assert.match(html, new RegExp(`/ ${e.updateN}</strong>`), "the page shows the evidence out of n");
      assert.match(html, new RegExp(`These ${e.updateN} trials`));
      assert.match(html, /30 \/ 100<\/strong>/, "the estimate stays out of 100");
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
    const xs = ["", "_2", "_3"].map(s => survey.getValue(k(`rare_generated_x${s}`)));
    assert.ok(xs.every(x => Number.isInteger(x) && x <= 10000), String(xs));
    assert.match(survey.getQuestionByName(k("rare_updated")).processedTitle, /out of the next 10,000 comparable attempts, how many would fail\?/);
    [3, 6, 9].forEach((v, i) => survey.setValue(k(`rare_updated${i ? `_${i + 1}` : ""}`), v));
    assert.equal(survey.getValue(k("rare_fit_valid")), true);
    assert.deepEqual(visible(), [k("estimate"), k("boundary"), k("boundary_scale"), k("rare_update"), k("rare_update_2"),
      k("rare_update_3"), k("rare_fit_check"), k("rating")]);
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
    assert.match(survey.getQuestionByName("diag_lowprob_answer").processedTitle, new RegExp(`Out of ${denominator.toLocaleString("en-US")} cleaning runs`));
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

  async backButtonOnUpdate() {
    const { survey, plan } = await loadApp("?variant=A");
    const e = ofMethod(plan, "update")[0];
    const k = (base) => `${e.id}_${base}`;
    survey.currentPage = survey.getPageByName(k("estimate"));
    survey.setValue(k("prior_successes"), 30);
    const evidence = ["", "_2", "_3"].map(s => survey.getValue(k(`generated_x${s}`)));
    ["", "_2", "_3"].forEach((s, i) => survey.setValue(k("updated_successes" + s), [32, 33, 31][i]));
    survey.setValue(k("width_check"), "too_wide");
    survey.currentPage = survey.getPageByName(k("fit_check"));
    survey.prevPage();
    assert.equal(survey.currentPage.name, k("update_3"));
    survey.nextPage();
    assert.equal(survey.getValue(k("width_check")), "too_wide", "just looking back changes nothing");
    assert.deepEqual(["", "_2", "_3"].map(s => survey.getValue(k(`generated_x${s}`))), evidence);
    survey.setValue(k("updated_successes_3"), 35);
    assert.equal(survey.getValue(k("width_check")), undefined, "a verdict on an old curve must not survive");
    survey.setValue(k("prior_successes"), 70);
    assert.equal(survey.getValue(k("updated_successes")), undefined);
    assert.equal(survey.getValue(k("fit_alpha")), undefined, "no stale fit after a new estimate");
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

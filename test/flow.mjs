/**
 * Integration test. Shims the browser globals app.js expects, imports it, and
 * drives the real model through the real handlers -- so page routing, item
 * isolation and the outgoing payload are all exercised as shipped.
 *
 * app.js is imported once per process (ES modules are cached), so each case
 * runs in its own child process via `--case`.
 */
import assert from "node:assert/strict";
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
  globalThis.requestAnimationFrame = (fn) => fn();
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
      showExpectedRange: false,
    },
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

/** Answers whatever the current page still requires, then advances. */
function runToEnd(survey, { name = "Test Person" } = {}) {
  let guard = 0;
  while (!survey.isCompleted && guard++ < 40) {
    const page = survey.currentPage;
    if (!page) break;
    for (const q of page.questions) {
      const empty = q.value === undefined || q.value === null || q.value === "";
      if (!q.isRequired || !empty) continue;
      if (q.name === "participant_name") q.value = name;
      else if (q.getType() === "radiogroup") q.value = q.choices[0].value;
      else q.value = 1;
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

const CASES = {
  async order() {
    const { survey, surveyJson } = await import("../src/app.js");
    const names = surveyJson.pages.map((p) => p.name);
    assert.equal(names.length, 14, "expected 9 training + 5 main pages");
    assert.ok(
      names.indexOf("training_intro") < names.indexOf("baseline"),
      "training must precede the real item",
    );
    for (const n of ["baseline", "evidence", "sanity", "reflection", "follow_up"]) {
      assert.ok(names.includes(n), `main page ${n} missing`);
    }
    assert.equal(survey.pages.length, 14);
  },

  async isolation() {
    const { survey } = await import("../src/app.js");
    survey.setValue("practice1_prior_successes", 80);
    survey.setValue("practice2_prior_successes", 30);
    survey.setValue("prior_successes", 55);

    const p1 = survey.getValue("practice1_generated_x");
    const p2 = survey.getValue("practice2_generated_x");
    const main = survey.getValue("generated_x");
    assert.ok(p1 < 80, "high prior should revise downward");
    assert.ok(p2 > 30, "low prior should revise upward");
    assert.ok(main < 55, "main prior 55 should revise downward");

    survey.setValue("practice1_updated_successes", 78);
    assert.equal(survey.getValue("practice1_fit_valid"), true);
    assert.equal(survey.getValue("fit_valid"), false, "main fit must not be set by practice");
    assert.equal(survey.getValue("fit_alpha"), undefined);

    survey.setValue("updated_successes", 53);
    assert.equal(survey.getValue("fit_valid"), true);
    assert.notEqual(
      survey.getValue("practice1_fit_alpha"),
      survey.getValue("fit_alpha"),
      "each item must keep its own fit",
    );
  },

  async payload() {
    const { survey } = await import("../src/app.js");
    survey.setValue("practice1_prior_successes", 70);
    survey.setValue("practice1_updated_successes", 68);
    survey.setValue("practice2_prior_successes", 40);
    survey.setValue("practice2_updated_successes", 43);
    survey.setValue("training_check", "38");
    survey.setValue("prior_successes", 30);
    survey.setValue("updated_successes", 33);

    const { stuck } = runToEnd(survey, { name: "  Ada Lovelace  " });
    assert.equal(stuck, null, `navigation stuck on ${stuck}`);
    assert.ok(survey.isCompleted, "survey did not complete");
    assert.equal(posts.length, 1, `expected exactly 1 POST, got ${posts.length}`);

    const p = posts[0];
    for (const k of [
      "prior_successes", "generated_x", "updated_successes",
      "fit_alpha", "fit_beta", "update_classification", "participant_name",
      "response_id", "submitted_at", "survey_version",
    ]) assert.ok(k in p, `payload missing established column "${k}"`);

    for (const k of [
      "practice1_prior_successes", "practice1_updated_successes",
      "practice2_prior_successes", "training_check",
    ]) assert.ok(k in p, `payload missing training column "${k}"`);

    assert.equal(p.participant_name, "Ada Lovelace", "name should be trimmed");
    assert.equal(p.update_classification, "toward_evidence");
    assert.ok(!("credible_interval_90" in p), "interval should be split in two");
    assert.ok("ci90_low" in p && "ci90_high" in p);
  },

  async boundaryPractice() {
    const { survey } = await import("../src/app.js");
    survey.setValue("practice1_prior_successes", 0);
    survey.setValue("practice2_prior_successes", 40);
    survey.setValue("prior_successes", 30);
    survey.setValue("updated_successes", 33);

    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, `navigation stuck on ${stuck}`);
    assert.ok(survey.isCompleted);

    const visible = survey.visiblePages.map((p) => p.name);
    assert.ok(!visible.includes("practice1_update"), "boundary practice must skip its update");
    assert.ok(!visible.includes("practice1_feedback"), "boundary practice must skip its feedback");
    assert.ok(visible.includes("practice2_update"), "the other practice must be unaffected");
    assert.equal(posts[0].fit_valid, true, "the real item must still be scored");
  },

  async boundaryMain() {
    const { survey } = await import("../src/app.js");
    survey.setValue("practice1_prior_successes", 40);
    survey.setValue("practice2_prior_successes", 50);
    survey.setValue("prior_successes", 100);

    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, `navigation stuck on ${stuck}`);
    assert.ok(survey.isCompleted);
    assert.ok(!survey.visiblePages.map((p) => p.name).includes("sanity"));
    assert.equal(posts[0].generated_x, "not_applicable_boundary_case");
  },

  async incoherentRealAnswer() {
    const { survey } = await import("../src/app.js");
    survey.setValue("practice1_prior_successes", 40);
    survey.setValue("practice2_prior_successes", 50);
    survey.setValue("prior_successes", 30);
    survey.setValue("updated_successes", 999);

    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, `navigation stuck on ${stuck}`);
    assert.ok(survey.isCompleted, "an impossible answer must not block completion");
    assert.equal(posts.length, 1, "an impossible answer must still be recorded");
    assert.equal(posts[0].update_classification, "overshoot_past_evidence");
    assert.equal(posts[0].updated_out_of_0_100, true);
    assert.equal(posts[0].fit_valid, false);
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

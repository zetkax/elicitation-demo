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
    const { survey, surveyJson } = await import('../src/app.js');
    const names = surveyJson.pages.map(p => p.name);
    assert.ok(names.indexOf('practice1_feedback') > names.indexOf('practice1_update'));
    assert.ok(!survey.visiblePages.some(p => p.name === 'practice1_feedback'));
    assert.ok(!names.includes('sanity') && !names.includes('practice2_feedback'));
    const hosts = surveyJson.pages.filter(p => JSON.stringify(p).includes('data-practice-explorer'));
    assert.deepEqual(hosts.map(p => p.name), ['practice1_feedback']);
    for (const n of ['evidence', 'evidence_2', 'evidence_3']) assert.ok(names.includes(n));
    assert.ok(!JSON.stringify(surveyJson).includes('training_check'));
  },
  async isolation() {
    const { survey } = await import('../src/app.js');
    survey.setValue('practice1_prior_successes', 70);
    survey.setValue('practice1_updated_successes', 68);
    survey.setValue('practice1_explored_update', 65);
    assert.equal(survey.getValue('practice1_updated_successes'), 68);
    assert.equal(survey.getValue('fit_alpha'), undefined);
    survey.setValue('prior_successes', 50);
    const evidence = [survey.getValue('generated_x'), survey.getValue('generated_x_2'), survey.getValue('generated_x_3')];
    assert.equal(new Set(evidence).size, 3);
    survey.setValue('updated_successes', 52);
    survey.setValue('updated_successes_2', 48);
    assert.equal(survey.getValue('fit_alpha'), undefined, 'no partial fit');
    survey.currentPage = survey.getPageByName('evidence_3');
    survey.setValue('updated_successes_3', 60);
    survey.nextPage();
    assert.equal(survey.getValue('fit_valid'), true);
    assert.deepEqual(evidence, [survey.getValue('generated_x'), survey.getValue('generated_x_2'), survey.getValue('generated_x_3')]);
    assert.equal(survey.getValue('fit_diagnostics').sampleCount, 3);
    survey.setValue('prior_successes', 60);
    assert.equal(survey.getValue('updated_successes_2'), undefined);
    assert.equal(survey.getValue('updated_successes_3'), undefined);
    assert.equal(survey.getValue('fit_alpha'), undefined);
  },
  async payload() {
    const { survey } = await import('../src/app.js');
    const { stuck } = runToEnd(survey, { name: '  Ada Lovelace  ' });
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts.length, 1);
    const p = posts[0];
    for (const k of ['prior_successes','generated_x','generated_x_2','generated_x_3',
      'updated_successes','updated_successes_2','updated_successes_3','fit_alpha','fit_beta',
      'fit_diagnostics','ci90_low','ci90_high','credible_interval_50','practice2_updated_successes_3']) {
      assert.ok(k in p, `missing ${k}`);
    }
    assert.equal(p.participant_name, 'Ada Lovelace');
    assert.equal(JSON.parse(p.fit_diagnostics).sampleCount, 3);
    assert.ok(Object.keys(p).length <= 120, 'collector field limit');
  },
  async boundaries() {
    const { survey } = await import('../src/app.js');
    survey.setValue('practice1_prior_successes', 0);
    survey.setValue('prior_successes', 100);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts[0].fit_valid, false);
    assert.equal(posts[0].fit_invalid_reason, 'boundary_mean');
    assert.equal(posts[0].updated_successes_3, 1);
    assert.ok(survey.getPageByName('practice1_feedback').isVisible);
  },
  async nonNormative() {
    const { survey } = await import('../src/app.js');
    survey.setValue('prior_successes', 30);
    survey.setValue('updated_successes', 20); // away from evidence is accepted
    survey.setValue('updated_successes_2', 90); // overshoot is also accepted
    survey.setValue('updated_successes_3', 30);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts[0].updated_successes, 20);
    assert.ok(JSON.parse(posts[0].fit_diagnostics).rmse > 0);
  },
  async validationAndGate() {
    const { survey } = await import('../src/app.js');
    survey.getAllQuestions().forEach(q => { q.focus = () => false; });
    survey.currentPage = survey.getPageByName('practice1_estimate');
    survey.setValue('practice1_prior_successes', 30.5);
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'practice1_estimate');
    survey.setValue('practice1_prior_successes', 30);
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'training_update');
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'practice1_update');
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'practice1_update');
    survey.setValue('practice1_updated_successes', 33);
    assert.equal(survey.currentPage.name, 'practice1_update');
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'practice1_feedback');
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'practice2_estimate');
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


/**
 * Integration test. Shims the browser globals app.js expects, imports it, and
 * drives the real model through the real handlers -- so page routing, item
 * isolation and the outgoing payload are all exercised as shipped.
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
function runToEnd(survey) {
  let guard = 0;
  while (!survey.isCompleted && guard++ < 200) {
    const page = survey.currentPage;
    if (!page) break;
    for (const q of page.questions) {
      const empty = q.value === undefined || q.value === null || q.value === "";
      if (!q.isRequired || !empty) continue;
      if (q.name === "consent") q.value = true;
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

// The first main question, by id from the registry, so renaming a question in
// questions.js does not break these tests. f('x') is that question's field x.
async function firstQuestion() {
  const { QUESTION_ITEMS } = await import('../src/items.js');
  const id = QUESTION_ITEMS[0].prefix;
  return { id, f: (base) => `${id}_${base}`, ids: QUESTION_ITEMS.map(i => i.prefix) };
}
// The collector rejects payloads with more fields than this, so every full
// response must stay under it. Read from Code.gs so the two cannot drift.
function collectorFieldLimit() {
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  return Number(src.match(/const MAX_FIELDS = (\d+);/)[1]);
}

const CASES = {
  async order() {
    const { survey, surveyJson } = await import('../src/app.js');
    const names = surveyJson.pages.map(p => p.name);
    assert.ok(names.indexOf('practice1_feedback') > names.indexOf('practice1_update'));
    assert.ok(!survey.visiblePages.some(p => p.name === 'practice1_feedback'));
    const hosts = surveyJson.pages.filter(p => JSON.stringify(p).includes('data-practice-explorer'));
    assert.deepEqual(hosts.map(p => p.name), ['practice1_feedback']);
    assert.equal(names[0], 'consent', 'consent comes before everything else');
    const firstMain = names.findIndex(n => n !== 'consent' && !n.startsWith('training') && !n.startsWith('practice'));
    assert.ok(names.indexOf('training_done') < firstMain, 'all training comes before the main questions');
    assert.ok(names.at(-1).endsWith('_reflection'), "the last question's reflection page is always last");
  },
  async randomOrder() {
    const { survey, surveyJson } = await import('../src/app.js');
    const { ids } = await firstQuestion();
    const order = survey.getValue('question_order');
    assert.deepEqual([...order].sort(), [...ids].sort(), 'every question appears exactly once');
    order.forEach((id, i) => assert.equal(survey.getValue(`${id}_position`), i + 1, `${id}_position`));
    // The pages really are in the recorded order, six per question, with
    // titles numbered by position rather than by question.
    const estimates = surveyJson.pages.filter(p => p.name.endsWith('_estimate') && !p.name.startsWith('practice'));
    assert.deepEqual(estimates.map(p => p.name.replace(/_estimate$/, '')), order);
    estimates.forEach((p, i) => assert.ok(p.title.startsWith(`Question ${i + 1} of ${ids.length}\n`), p.title));
    for (const id of ids) {
      const own = surveyJson.pages.filter(p => p.name.startsWith(`${id}_`)).map(p => p.name);
      assert.deepEqual(own, [`${id}_estimate`, `${id}_update`, `${id}_update_2`, `${id}_update_3`, `${id}_fit_check`, `${id}_reflection`]);
    }
  },
  async isolation() {
    const { survey } = await import('../src/app.js');
    const { f, ids } = await firstQuestion();
    survey.setValue('practice1_prior_successes', 70);
    survey.setValue('practice1_updated_successes', 68);
    assert.equal(survey.getValue(f('fit_alpha')), undefined, 'practice must not touch a main question');
    survey.setValue(f('prior_successes'), 50);
    const evidence = ['generated_x', 'generated_x_2', 'generated_x_3'].map(k => survey.getValue(f(k)));
    assert.equal(new Set(evidence).size, 3);
    survey.setValue(f('updated_successes'), 52);
    survey.setValue(f('updated_successes_2'), 48);
    assert.equal(survey.getValue(f('fit_alpha')), undefined, 'no partial fit');
    survey.setValue(f('updated_successes_3'), 60);
    assert.equal(survey.getValue(f('fit_valid')), true);
    assert.equal(survey.getValue(f('fit_diagnostics')).sampleCount, 3);
    // Questions are independent of each other.
    for (const other of ids.slice(1)) {
      assert.equal(survey.getValue(`${other}_prior_successes`), undefined);
      assert.equal(survey.getValue(`${other}_fit_alpha`), undefined, `${other} must be untouched`);
    }
    survey.setValue(f('prior_successes'), 60);
    assert.equal(survey.getValue(f('updated_successes_2')), undefined);
    assert.equal(survey.getValue(f('fit_alpha')), undefined);
  },
  async payload() {
    const { survey } = await import('../src/app.js');
    const { ids } = await firstQuestion();
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts.length, 1);
    const p = posts[0];
    // Every question has its own full set of columns, whatever order it ran in.
    for (const id of ids) {
      for (const k of ['prior_successes', 'generated_x', 'generated_x_2', 'generated_x_3',
        'updated_successes', 'updated_successes_2', 'updated_successes_3', 'fit_alpha', 'fit_beta',
        'fit_diagnostics', 'credible_interval_50', 'width_check', 'position', 'evidence_kinds']) {
        assert.ok(`${id}_${k}` in p, `missing ${id}_${k}`);
      }
      assert.deepEqual(JSON.parse(p[`${id}_evidence_kinds`]).slice().sort(), ['extreme', 'jump', 'middle']);
      assert.equal(JSON.parse(p[`${id}_fit_diagnostics`]).sampleCount, 3);
    }
    assert.deepEqual(JSON.parse(p.question_order).slice().sort(), [...ids].sort());
    assert.deepEqual(ids.map(id => p[`${id}_position`]).sort((a, b) => a - b), ids.map((_, i) => i + 1));
    assert.ok('practice2_updated_successes_3' in p);
    assert.deepEqual(JSON.parse(p.practice2_evidence_kinds).slice().sort(), ['extreme', 'jump', 'middle']);
    for (const key of ['participant_name', 'user_agent', 'submitted_at', 'started_at']) {
      assert.ok(!(key in p), `${key} must not be collected: responses are anonymous`);
    }
    assert.match(p.submitted_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(p.chart_style, 'line', 'the style shown must be recorded with the response');
    const limit = collectorFieldLimit();
    assert.ok(Object.keys(p).length <= limit, `payload has ${Object.keys(p).length} fields; collector accepts ${limit}`);
    console.error(`PAYLOAD_FIELDS=${Object.keys(p).length}`);
  },
  async boundaries() {
    const { survey } = await import('../src/app.js');
    const { f } = await firstQuestion();
    survey.setValue('practice1_prior_successes', 0);
    survey.setValue(f('prior_successes'), 100);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts[0][f('fit_valid')], false);
    assert.equal(posts[0][f('fit_invalid_reason')], 'boundary_mean');
    assert.equal(posts[0][f('updated_successes_3')], 1);
    assert.ok(survey.getPageByName('practice1_feedback').isVisible);
  },
  async nonNormative() {
    const { survey } = await import('../src/app.js');
    const { f } = await firstQuestion();
    survey.setValue(f('prior_successes'), 30);
    survey.setValue(f('updated_successes'), 20); // away from evidence is accepted
    survey.setValue(f('updated_successes_2'), 90); // overshoot is also accepted
    survey.setValue(f('updated_successes_3'), 30);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.ok(survey.isCompleted);
    assert.equal(posts[0][f('updated_successes')], 20);
    assert.ok(JSON.parse(posts[0][f('fit_diagnostics')]).rmse > 0);
  },
  async practice2FitCheck() {
    const { survey } = await import('../src/app.js');
    const { f } = await firstQuestion();
    const page = () => survey.getPageByName('practice2_fit_check');
    survey.setValue('practice2_prior_successes', 30);
    assert.ok(!page().isVisible, 'no fit yet, so the check page must be hidden');
    survey.setValue('practice2_updated_successes', 32);
    survey.setValue('practice2_updated_successes_2', 33);
    assert.ok(!page().isVisible, 'two of three answers is not enough to fit');
    survey.setValue('practice2_updated_successes_3', 31);
    assert.equal(survey.getValue('practice2_fit_valid'), true);
    assert.ok(page().isVisible, 'three answers fit, so the check page must show');
    assert.equal(survey.getValue(f('fit_alpha')), undefined, 'practice fit must not touch the real items');
    survey.setValue('practice2_width_check', 'too_wide');
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.equal(posts[0].practice2_width_check, 'too_wide');
    assert.ok(posts[0].practice2_fit_alpha > 0, 'the practice fit it was shown must be recorded');
  },
  async practice2FitCheckBoundary() {
    const { survey } = await import('../src/app.js');
    survey.setValue('practice2_prior_successes', 0);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, 'a boundary estimate must not strand the respondent');
    assert.ok(!survey.visiblePages.some(p => p.name === 'practice2_fit_check'));
    assert.ok(survey.isCompleted);
  },
  async mainFitCheck() {
    const { survey } = await import('../src/app.js');
    const { f, id, ids } = await firstQuestion();
    const page = () => survey.getPageByName(`${id}_fit_check`);
    survey.setValue(f('prior_successes'), 30);
    survey.setValue(f('updated_successes'), 32);
    survey.setValue(f('updated_successes_2'), 33);
    assert.ok(!page().isVisible, 'two of three answers is not enough to fit');
    assert.equal(survey.getValue(f('fit_alpha')), undefined, 'no partial fit may be saved');
    survey.setValue(f('updated_successes_3'), 31);
    assert.equal(survey.getValue(f('fit_valid')), true);
    assert.ok(page().isVisible, 'three answers fit, so the check page must show');
    assert.equal(survey.getValue('practice2_fit_alpha'), undefined, 'a real fit must not touch practice 2');
    assert.ok(!survey.getPageByName(`${ids[1]}_fit_check`).isVisible, "another question's check page is unaffected");
    survey.setValue(f('width_check'), 'too_narrow');
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null);
    assert.equal(posts[0][f('width_check')], 'too_narrow');
    assert.ok(posts[0][f('fit_alpha')] > 0, 'the fit it was shown must be recorded');
  },
  async mainFitCheckBoundary() {
    const { survey } = await import('../src/app.js');
    const { f, id } = await firstQuestion();
    survey.setValue(f('prior_successes'), 100);
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, 'a boundary estimate must not strand the respondent');
    assert.ok(!survey.visiblePages.some(p => p.name === `${id}_fit_check`));
    assert.ok(survey.visiblePages.some(p => p.name === `${id}_reflection`), 'and must still reach the reflection page');
  },
  async reflectionPerQuestion() {
    const { survey } = await import('../src/app.js');
    const { ids } = await firstQuestion();
    ids.forEach((id, i) => {
      survey.setValue(`${id}_clarity_rating`, (i % 5) + 1);
      if (i) survey.setValue(`${id}_missing_info`, `  I'd want to know the agent's error rate for ${id}  `);
    });
    const { stuck } = runToEnd(survey);
    assert.equal(stuck, null, 'the free-text box is optional, so leaving one blank must not block');
    ids.forEach((id, i) => {
      assert.equal(posts[0][`${id}_clarity_rating`], (i % 5) + 1, 'clarity saved per question');
      assert.ok(!(`${id}_uncertainty_source` in posts[0]), 'struck uncertainty questions are not asked');
      if (i) assert.equal(posts[0][`${id}_missing_info`], `I'd want to know the agent's error rate for ${id}`, 'saved per question, trimmed');
    });
    assert.ok(!(`${ids[0]}_missing_info` in posts[0]) || posts[0][`${ids[0]}_missing_info`] === '', 'a blank box sends nothing');
  },
  async clarityOnMainOnly() {
    const { surveyJson } = await import('../src/app.js');
    const { ids } = await firstQuestion();
    const withClarity = surveyJson.pages
      .filter(p => p.elements.some(e => e.name?.endsWith('_clarity_rating')))
      .map(p => p.name);
    assert.deepEqual(withClarity.sort(), ids.map(id => `${id}_reflection`).sort());
  },
  async backButton() {
    const { survey } = await import('../src/app.js');
    const { f, id } = await firstQuestion();
    assert.equal(survey.showPrevButton, true);
    // Going back and forward without editing keeps everything.
    survey.currentPage = survey.getPageByName(`${id}_estimate`);
    survey.setValue(f('prior_successes'), 30);
    const evidence = ['generated_x', 'generated_x_2', 'generated_x_3'].map(k => survey.getValue(f(k)));
    ['', '_2', '_3'].forEach((s, i) => survey.setValue(f('updated_successes' + s), [32, 33, 31][i]));
    survey.setValue(f('width_check'), 'too_wide');
    survey.currentPage = survey.getPageByName(`${id}_fit_check`);
    survey.prevPage();
    assert.equal(survey.currentPage.name, `${id}_update_3`, 'Back goes to the previous page');
    survey.nextPage();
    assert.equal(survey.getValue(f('width_check')), 'too_wide', 'just looking back changes nothing');
    assert.deepEqual(['generated_x', 'generated_x_2', 'generated_x_3'].map(k => survey.getValue(f(k))), evidence);
    // Changing an update invalidates the verdict about the old curve.
    survey.setValue(f('updated_successes_3'), 35);
    assert.equal(survey.getValue(f('width_check')), undefined, 'a verdict on an old curve must not survive');
    assert.equal(survey.getValue(f('fit_valid')), true, 'the fit is redone from the new answers');
    // Changing the initial estimate regenerates the evidence and clears the updates.
    survey.setValue(f('width_check'), 'about_right');
    survey.setValue(f('prior_successes'), 70);
    assert.equal(survey.getValue(f('updated_successes')), undefined);
    assert.equal(survey.getValue(f('width_check')), undefined);
    assert.equal(survey.getValue(f('fit_alpha')), undefined, 'no stale fit after a new estimate');
    // The practice explorer restarts from a changed practice answer.
    survey.setValue('practice1_prior_successes', 40);
    survey.setValue('practice1_updated_successes', 43);
    survey.setValue('practice1_explored_update', 46);
    survey.setValue('practice1_updated_successes', 44);
    assert.equal(survey.getValue('practice1_explored_update'), undefined);
  },
  async consentGate() {
    const { survey } = await import('../src/app.js');
    survey.getAllQuestions().forEach(q => { q.focus = () => false; });
    assert.equal(survey.currentPage.name, 'consent');
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'consent', 'cannot start without consenting');
    survey.setValue('consent', false);
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'consent', 'an unticked box is not consent');
    survey.setValue('consent', true);
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'training_intro');
    assert.equal(runToEnd(survey).stuck, null);
    assert.equal(posts.at(-1).consent, true);
    assert.equal(posts.at(-1).answers_required, true);
  },
  async optionalAnswers() {
    window.ELICITATION_CONFIG.requireAnswers = false;
    const { survey } = await import('../src/app.js');
    survey.getAllQuestions().forEach(q => { q.focus = () => false; });
    survey.nextPage();
    assert.equal(survey.currentPage.name, 'consent', 'consent is still required');
    survey.setValue('consent', true);
    // Everything else can be skipped, straight through to Finish.
    let guard = 0;
    while (!survey.isLastPage && guard++ < 200) {
      const before = survey.currentPage.name;
      survey.nextPage();
      assert.notEqual(survey.currentPage.name, before, `stuck on ${before}`);
    }
    survey.completeLastPage();
    assert.ok(survey.isCompleted);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(posts.at(-1).answers_required, false, 'skippable responses are labelled as such');
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


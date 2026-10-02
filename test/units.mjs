import assert from "node:assert/strict";
import { chooseHypotheticalX, calculateBetaFit, classifyUpdate, betaQuantile, fitBetaUpdates, chooseHypotheticalSamples } from "../src/stats.js";
import { formatCount, formatPercent } from "../src/format.js";
import { practiceCommentHtml, practiceMissHtml } from "../src/feedback.js";
import { makeItem, QUESTION_ITEMS, PRACTICE_ITEMS } from "../src/items.js";
import { buildMainPages } from "../src/pages/main.js";
import { createStore } from "../src/persistence.js";

let pass = 0, fail = 0;
const ck = (n, fn) => { try { fn(); pass++; console.log(`  PASS  ${n}`); }
                        catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`); } };

console.log("\n-- stats: evidence generation --");
ck("mu<0.5 revises upward", () => assert.ok(chooseHypotheticalX(30) > 30));
ck("mu>0.5 revises downward", () => assert.ok(chooseHypotheticalX(70) < 70));
ck("boundaries return null", () => { assert.equal(chooseHypotheticalX(0), null); assert.equal(chooseHypotheticalX(100), null); });
ck("non-integer returns null", () => assert.equal(chooseHypotheticalX(30.5), null));
ck("deterministic at mu=0.5 when forced", () => assert.ok(chooseHypotheticalX(50, "up") > 50));

console.log("\n-- stats: beta fit --");
ck("in-range update fits", () => assert.equal(calculateBetaFit(30, 39, 33.5).valid, true));
ck("update equal to prior does not fit", () => assert.equal(calculateBetaFit(30, 39, 30).valid, false));
ck("update equal to evidence does not fit", () => assert.equal(calculateBetaFit(30, 39, 39).valid, false));
ck("overshoot does not fit", () => assert.equal(calculateBetaFit(30, 39, 50).valid, false));
ck("smaller revision => tighter interval", () => {
  const tight = calculateBetaFit(30, 39, 31);
  const loose = calculateBetaFit(30, 39, 38);
  const w = (f) => betaQuantile(0.95, f.alpha, f.beta) - betaQuantile(0.05, f.alpha, f.beta);
  assert.ok(w(tight) < w(loose), "a small revision must imply more confidence");
});

console.log("\n-- stats: update classification --");
for (const [label, args, want] of [
  ["coherent",        [30, 39, 33.5], "toward_evidence"],
  ["no change",       [30, 39, 30],   "no_change"],
  ["copied evidence", [30, 39, 39],   "matched_evidence"],
  ["overshoot",       [30, 39, 50],   "overshoot_past_evidence"],
  ["wrong direction", [30, 39, 20],   "away_from_evidence"],
  ["downward prior",  [70, 61, 66],   "toward_evidence"],
  ["blank",           [30, 39, NaN],  "not_applicable"],
]) ck(`classify ${label}`, () => assert.equal(classifyUpdate(...args), want));

console.log("\n-- format --");
ck("integers print bare", () => assert.equal(formatCount(33), "33"));
ck("decimals keep one place", () => assert.equal(formatCount(33.45), "33.5"));
ck("percent rounds", () => assert.equal(formatPercent(0.4312, 0), "43%"));

console.log("\n-- feedback wording --");
ck("feedback never leaks into real item", () => {
  assert.ok(QUESTION_ITEMS.every((i) => !i.isPractice), 'main questions are not practice');
  assert.ok(PRACTICE_ITEMS.every((i) => i.isPractice));
});

console.log("\n-- items --");
ck("main questions are namespaced by their id", () => {
  for (const item of QUESTION_ITEMS) {
    assert.equal(item.prior, `${item.prefix}_prior_successes`);
    assert.equal(item.fitAlpha, `${item.prefix}_fit_alpha`);
    assert.equal(item.updates.length, 3);
  }
});
ck("practice field names are unchanged", () => {
  assert.equal(PRACTICE_ITEMS[0].prior, "practice1_prior_successes");
  assert.equal(PRACTICE_ITEMS[1].updates[2].answer, "practice2_updated_successes_3");
});
ck("question order changes the pages shown, never the field names", () => {
  const fields = (order) => buildMainPages(order).flatMap((p) => p.elements.map((e) => e.name)).sort();
  const forward = buildMainPages(QUESTION_ITEMS), backward = buildMainPages([...QUESTION_ITEMS].reverse());
  assert.deepEqual(fields(QUESTION_ITEMS), fields([...QUESTION_ITEMS].reverse()));
  assert.notDeepEqual(forward.map((p) => p.name), backward.map((p) => p.name), 'the page order itself must differ');
  const firstQuestion = backward.find((p) => p.name.endsWith('_estimate'));
  assert.ok(firstQuestion.title.startsWith('Question 1 of '), 'titles follow display position, not the question');
});
ck("shared context: in full first, then a collapsed reminder on every question page", () => {
  const pages = buildMainPages(QUESTION_ITEMS);
  assert.equal(pages[0].name, 'shared_context', 'shown on its own before the first question');
  const questionPages = pages.filter((p) => QUESTION_ITEMS.some((q) => p.name.startsWith(`${q.prefix}_`)));
  assert.equal(questionPages.length, QUESTION_ITEMS.length * 6);
  for (const p of questionPages) {
    const first = p.elements[0];
    assert.match(first.html, /<details class="context-reminder">/, `${p.name}: reminder must be first`);
    assert.doesNotMatch(first.html, /<details[^>]* open/, `${p.name}: reminder must start collapsed`);
  }
});
ck("practice items are namespaced", () => assert.equal(makeItem("practice1").prior, "practice1_prior_successes"));

console.log("\n-- persistence --");
const mkStore = (endpoint, fetchImpl) => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true });
  globalThis.window = { crypto: { randomUUID: () => "fixed-id" } };
  globalThis.fetch = fetchImpl;
  return createStore({ endpoint, surveyVersion: "t", startedAt: new Date().toISOString() });
};
ck("payload flattens the interval into two columns", () => {
  const s = mkStore("https://x.test", async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const p = s.buildPayload({ prior_successes: 30, credible_interval_90: [0.2, 0.4] });
  assert.equal(p.ci90_low, 0.2); assert.equal(p.ci90_high, 0.4);
  assert.ok(!("credible_interval_90" in p));
});
ck("free text is trimmed", () => {
  const s = mkStore("https://x.test", async () => ({ ok: true, json: async () => ({ ok: true }) }));
  assert.equal(s.buildPayload({ q_missing_info: "  unclear  " }).q_missing_info, "unclear");
});
ck("retry does not duplicate in the buffer", () => {
  const s = mkStore("https://x.test", async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const p = { response_id: "same" };
  s.queuePending(p); s.queuePending(p); s.queuePending(p);
  assert.equal(s.readPending().length, 1);
  s.dropPending("same");
  assert.equal(s.readPending().length, 0);
});

ck('joint fit recovers known concentration across 3 samples', () => {
  const s = 40, nu = 250;
  const samples = [20, 50, 80].map(x => ({ x, updated: (nu * s + 100 * x) / (nu + 100) }));
  const f = fitBetaUpdates(s, samples);
  assert.ok(f.valid);
  assert.ok(Math.abs(f.nu - nu) < 1e-9);
  assert.ok(f.diagnostics.rmse < 1e-10);
});
ck('all answers affect joint fit and diagnostics', () => {
  const a = [{x:20,updated:35},{x:80,updated:50},{x:60,updated:45}];
  const exact = fitBetaUpdates(40,a);
  const noisy = fitBetaUpdates(40,[a[0],a[1],{x:60,updated:49}]);
  assert.notEqual(exact.nu,noisy.nu);
  assert.ok(noisy.diagnostics.rmse > 0);
});
ck('missing responses are not converted to zeros', () => {
  for (const updated of ['', null, undefined, NaN, Infinity]) {
    assert.equal(fitBetaUpdates(40,[{x:20,updated:35},{x:80,updated}]).valid,false);
  }
  assert.equal(fitBetaUpdates(40,[{x:20,updated:35}]).valid,false);
});
ck('fit bounds are flagged internally with finite quantiles', () => {
  for (const updates of [[40,40],[20,80],[90,0]]) {
    const f=fitBetaUpdates(40,[{x:20,updated:updates[0]},{x:80,updated:updates[1]}]);
    assert.ok(f.valid && f.diagnostics.atBoundary);
    const low=betaQuantile(.25,f.alpha,f.beta), high=betaQuantile(.75,f.alpha,f.beta);
    assert.ok(Number.isFinite(low) && low <= high && high <= 1);
  }
});
ck('boundary means remain unfitted', () => {
  for (const s of [0,100]) assert.equal(fitBetaUpdates(s,[{x:20,updated:30},{x:80,updated:60}]).reason,'boundary_mean');
});
// Seeded generator so the random draws below are reproducible test to test.
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

ck('three distinct hypothetical samples, of the right kinds, for every estimate', () => {
  const rng = seeded(42);
  for (let s = 0; s <= 100; s++) for (let draw = 0; draw < 25; draw++) {
    const out = chooseHypotheticalSamples(s, { rng });
    const xs = out.map(e => e.x);
    assert.equal(out.length, 3);
    assert.equal(new Set(xs).size, 3, `duplicates at s=${s}: ${xs}`);
    assert.ok(xs.every(x => Number.isInteger(x) && x >= 0 && x <= 100 && x !== s), `bad value at s=${s}: ${xs}`);
    if (s === 0 || s === 100) { assert.ok(out.every(e => e.kind === 'boundary')); continue; }
    const by = Object.fromEntries(out.map(e => [e.kind, e.x]));
    assert.deepEqual(Object.keys(by).sort(), ['extreme', 'jump', 'middle']);
    // Direction: "middle" and "jump" head towards 50, "extreme" away from it.
    const toMiddle = Math.sign(by.middle - s);
    if (s !== 50) assert.equal(toMiddle, Math.sign(50 - s), `middle went the wrong way at s=${s}`);
    assert.equal(Math.sign(by.jump - s), toMiddle, `jump went the wrong way at s=${s}`);
    assert.equal(Math.sign(by.extreme - s), -toMiddle, `extreme went the wrong way at s=${s}`);
    // Size: the jump is 30-50 points unless the scale's edge stops it.
    const jump = Math.abs(by.jump - s);
    assert.ok((jump >= 30 && jump <= 50) || by.jump === 0 || by.jump === 100, `jump of ${jump} at s=${s}`);
    assert.ok(jump > Math.abs(by.middle - s), 'the jump must be bigger than the moderate move');
  }
});
ck('hypothetical samples vary between respondents with the same estimate', () => {
  const rng = seeded(7);
  for (const s of [10, 30, 50, 70, 90]) {
    const seen = new Set(Array.from({ length: 40 }, () =>
      chooseHypotheticalSamples(s, { rng }).map(e => `${e.kind}:${e.x}`).sort().join(',')));
    assert.ok(seen.size >= 10, `only ${seen.size} distinct sets at s=${s}`);
  }
});
ck('hypothetical sample order is shuffled', () => {
  const rng = seeded(3);
  const lastKinds = new Set(Array.from({ length: 60 }, () => chooseHypotheticalSamples(30, { rng })[2].kind));
  assert.equal(lastKinds.size, 3, 'every kind should sometimes come last');
});
ck('practice 1 (single update) gets one moderate move towards 50', () => {
  const rng = seeded(11);
  for (const s of [5, 30, 49, 51, 70, 95]) {
    const out = chooseHypotheticalSamples(s, { count: 1, rng });
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'middle');
    assert.equal(Math.sign(out[0].x - s), Math.sign(50 - s));
  }
});
ck('moderate moves hit the intended surprise level', () => {
  // Re-derive each "middle" result's binomial tail probability: it should sit
  // within the 5-20% range (allowing one count of slack for whole numbers).
  const rng = seeded(5);
  const tailUp = (s, x) => { let t = 0; for (let k = x; k <= 100; k++) t += Math.exp(logChoose(100, k) + k * Math.log(s / 100) + (100 - k) * Math.log(1 - s / 100)); return t; };
  const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);
  const lf = [0]; for (let i = 1; i <= 100; i++) lf[i] = lf[i - 1] + Math.log(i);
  const logFact = (i) => lf[i];
  for (const s of [20, 30, 40]) for (let d = 0; d < 20; d++) {
    const x = chooseHypotheticalSamples(s, { count: 1, rng })[0].x;
    assert.ok(tailUp(s, x + 1) <= 0.2 + 1e-9 && tailUp(s, x - 1) >= 0.05 - 1e-9, `s=${s} x=${x}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);



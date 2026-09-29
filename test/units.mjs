import assert from "node:assert/strict";
import { chooseHypotheticalX, calculateBetaFit, classifyUpdate, betaQuantile, fitBetaUpdates, chooseHypotheticalSamples } from "../src/stats.js";
import { formatCount, formatPercent } from "../src/format.js";
import { practiceCommentHtml, practiceMissHtml } from "../src/feedback.js";
import { makeItem, MAIN_ITEM, PRACTICE_ITEMS } from "../src/items.js";
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
  assert.equal(MAIN_ITEM.isPractice, false);
  assert.ok(PRACTICE_ITEMS.every((i) => i.isPractice));
});

console.log("\n-- items --");
ck("main item keeps unprefixed names", () => {
  assert.equal(MAIN_ITEM.prior, "prior_successes");
  assert.equal(MAIN_ITEM.generatedX, "generated_x");
  assert.equal(MAIN_ITEM.fitAlpha, "fit_alpha");
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
  assert.equal(s.buildPayload({ participant_name: "  Ada  " }).participant_name, "Ada");
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
ck('three distinct reproducible hypothetical samples for every count', () => {
  for (let s=0;s<=100;s++) {
    const xs=chooseHypotheticalSamples(s);
    assert.equal(new Set(xs).size,3);
    assert.ok(xs.every(x=>x>=0 && x<=100 && x!==s));
    assert.deepEqual(xs,chooseHypotheticalSamples(s));
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);



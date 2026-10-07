import assert from "node:assert/strict";
import { chooseHypotheticalX, calculateBetaFit, classifyUpdate, betaQuantile, fitBetaUpdates, binomialPmf } from "../src/stats.js";
import { generateEvidence, EVIDENCE_RULE } from "../src/evidence.js";
import { formatCount, formatPercent } from "../src/format.js";
import { assignParticipant, parseVariant, planSummary } from "../src/assignment.js";
import { VARIANTS, DIAGNOSTIC_PLACEMENT, FINE_SCALE } from "../src/design.js";
import { chipsTotal, chipsError, normaliseChips, binLabel } from "../src/chips.js";
import { makeQuestionItem, PRACTICE } from "../src/items.js";
import { QUESTIONS } from "../src/questions.js";
import { buildMainSection } from "../src/pages/main.js";
import { FORMAT_RATING_TITLE } from "../src/pages/blocks.js";
import { createStore } from "../src/persistence.js";

let pass = 0, fail = 0;
const ck = (n, fn) => { try { fn(); pass++; console.log(`  PASS  ${n}`); }
                        catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`); } };
// Seeded generator so the random draws below are reproducible test to test.
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const count = (list, v) => list.filter((x) => x === v).length;

console.log("\n-- assignment: versions, methods, sample sizes, order --");
ck("?variant= is read case-insensitively; anything else is ignored", () => {
  assert.equal(parseVariant("?variant=b"), "B");
  assert.equal(parseVariant("?x=1&variant=C"), "C");
  for (const bad of ["", "?variant=D", "?variant=", "?v=A"]) assert.equal(parseVariant(bad), null, bad);
});
ck("each version maps Q1-Q6 to the methods in the design table", () => {
  const expected = {
    A: ["percentiles", "chips", "update", "percentiles", "chips", "update"],
    B: ["chips", "update", "percentiles", "chips", "update", "percentiles"],
    C: ["update", "percentiles", "chips", "update", "percentiles", "chips"],
  };
  assert.deepEqual(VARIANTS, expected);
  for (const v of Object.keys(expected)) {
    const plan = assignParticipant(QUESTIONS, { variant: v, rng: seeded(1) });
    assert.equal(plan.variant, v);
    assert.equal(plan.variantSource, "url");
    QUESTIONS.forEach((q, i) => assert.equal(plan.main.find((e) => e.id === q.id).method, expected[v][i], `${v} Q${i + 1}`));
  }
});
ck("every participant gets 2 of each method, all 6 questions once, one Update at n=20 and one at n=100", () => {
  const rng = seeded(42);
  for (let k = 0; k < 300; k++) {
    const plan = assignParticipant(QUESTIONS, { rng });
    const methods = plan.main.map((e) => e.method);
    for (const m of ["percentiles", "chips", "update"]) assert.equal(count(methods, m), 2, `${m} in ${methods}`);
    assert.deepEqual(plan.main.map((e) => e.id).sort(), QUESTIONS.map((q) => q.id).sort());
    assert.deepEqual(plan.main.map((e) => e.position), [1, 2, 3, 4, 5, 6]);
    const ns = plan.main.filter((e) => e.method === "update").map((e) => e.updateN).sort((a, b) => a - b);
    assert.deepEqual(ns, [20, 100]);
    assert.ok(plan.main.filter((e) => e.method !== "update").every((e) => e.updateN === null));
  }
});
ck("random assignment covers all three versions, both n orders, and many question orders", () => {
  const rng = seeded(7);
  const plans = Array.from({ length: 300 }, () => assignParticipant(QUESTIONS, { rng }));
  assert.deepEqual(new Set(plans.map((p) => p.variant)), new Set(["A", "B", "C"]));
  assert.equal(new Set(plans.map((p) => p.main.filter((e) => e.method === "update").map((e) => `${e.id}:${e.updateN}`).sort().join())).size > 2, true);
  assert.ok(new Set(plans.map((p) => p.main.map((e) => e.id).join())).size > 100, "orders should vary");
  assert.deepEqual(new Set(plans.map((p) => p.lowProbDenominator)), new Set([100, 1000]));
  assert.ok(plans.every((p) => p.variantSource === "random"));
});
ck("shuffling the order never changes a question's method", () => {
  const rng = seeded(9);
  for (const v of ["A", "B", "C"]) for (let k = 0; k < 50; k++) {
    const plan = assignParticipant(QUESTIONS, { variant: v, rng });
    for (const e of plan.main) assert.equal(e.method, VARIANTS[v][QUESTIONS.findIndex((q) => q.id === e.id)]);
  }
});
ck("the consistency target is the first Percentiles question actually presented", () => {
  const rng = seeded(3);
  for (let k = 0; k < 100; k++) {
    const plan = assignParticipant(QUESTIONS, { rng });
    const first = plan.main.find((e) => e.method === "percentiles");
    assert.equal(plan.consistencyTarget, first.id);
    assert.ok(plan.main.slice(0, first.position - 1).every((e) => e.method !== "percentiles"));
  }
});
ck("the stored plan summary rebuilds what was shown", () => {
  const plan = assignParticipant(QUESTIONS, { variant: "A", rng: seeded(5) });
  assert.deepEqual(planSummary(plan), plan.main.map((e) => ({ id: e.id, method: e.method, n: e.updateN, position: e.position })));
});

console.log("\n-- evidence: tail-matched hypothetical results --");
const tailOf = (n, mu, x, dir) => {
  const pmf = binomialPmf(n, mu);
  return dir === "up" ? pmf.slice(x).reduce((a, b) => a + b, 0) : pmf.slice(0, x + 1).reduce((a, b) => a + b, 0);
};
ck("three results of the right kinds and directions, at n = 20 and n = 100", () => {
  const rng = seeded(11);
  for (const n of [20, 100]) for (let s = 1; s <= 99; s++) {
    const out = generateEvidence(s, { n, rng });
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((e) => e.kind).sort(), ["extreme", "jump", "middle"]);
    for (const e of out) assert.ok(Number.isInteger(e.x) && e.x >= 0 && e.x <= n, `n=${n} s=${s}: ${e.x}`);
    const by = Object.fromEntries(out.map((e) => [e.kind, e.x]));
    const exp = (n * s) / 100;
    if (s < 50) {
      assert.ok(by.middle > exp && by.jump > exp, `towards 50 at n=${n} s=${s}`);
      assert.ok(by.jump >= by.middle, `the jump is at least as far at n=${n} s=${s}`);
    }
    if (s > 50) assert.ok(by.middle < exp && by.jump < exp, `towards 50 at n=${n} s=${s}`);
  }
});
ck("the same estimate gives similarly surprising results at n = 20 and n = 100", () => {
  // Achieved tails sit near the configured ranges at both sizes wherever the
  // counts are not too coarse (mid-range estimates).
  const rng = seeded(13);
  const moderate = EVIDENCE_RULE.kinds[1].tail;
  for (const n of [20, 100]) for (const s of [25, 30, 40, 60, 70, 75]) for (let d = 0; d < 10; d++) {
    const by = Object.fromEntries(generateEvidence(s, { n, rng }).map((e) => [e.kind, e]));
    assert.ok(by.middle.tail > moderate[0] / 3 && by.middle.tail < moderate[1] * 1.6, `middle tail ${by.middle.tail} at n=${n} s=${s}`);
    assert.ok(by.jump.tail < 0.05, `jump tail ${by.jump.tail} at n=${n} s=${s}`);
    // The recorded tail is the true binomial tail of the count shown.
    const dir = s < 50 ? "up" : "down";
    assert.ok(Math.abs(by.middle.tail - tailOf(n, s / 100, by.middle.x, dir)) < 1e-9);
  }
});
ck("in points, the same surprise is a bigger move at n = 20 than at n = 100", () => {
  const rng = seeded(17);
  const avgMove = (n) => {
    let total = 0;
    for (let d = 0; d < 200; d++) total += Math.abs(generateEvidence(30, { n, rng }).find((e) => e.kind === "jump").x * 100 / n - 30);
    return total / 200;
  };
  assert.ok(avgMove(20) > avgMove(100));
});
ck("results vary between respondents and the order is shuffled", () => {
  const rng = seeded(19);
  const sets = new Set(Array.from({ length: 40 }, () => generateEvidence(30, { n: 100, rng }).map((e) => e.x).sort().join()));
  assert.ok(sets.size >= 5);
  const last = new Set(Array.from({ length: 60 }, () => generateEvidence(30, { n: 100, rng })[2].kind));
  assert.equal(last.size, 3, "every kind should sometimes come last");
});
ck("at 0 or 100 (training only) spread-out results keep the format working", () => {
  for (const s of [0, 100]) {
    const out = generateEvidence(s, { n: 20, rng: seeded(23) });
    assert.equal(out.length, 3);
    assert.ok(out.every((e) => e.kind === "boundary" && e.x >= 0 && e.x <= 20));
  }
});
ck("the fine scale (estimate and evidence out of 10,000) stays close to the rare estimate", () => {
  const out = generateEvidence(5, { n: FINE_SCALE, scale: FINE_SCALE, rng: seeded(29) });
  assert.ok(out.every((e) => e.x <= 50), JSON.stringify(out));
});
ck("invalid estimates give no evidence", () => {
  for (const s of [undefined, "", -1, 101, NaN]) assert.deepEqual(generateEvidence(s, { n: 20 }), []);
});

console.log("\n-- stats: beta fit --");
ck("legacy single-update helpers still behave", () => {
  assert.ok(chooseHypotheticalX(30) > 30);
  assert.equal(chooseHypotheticalX(0), null);
  assert.equal(calculateBetaFit(30, 39, 33.5).valid, true);
});
ck("joint fit recovers known concentration across 3 samples (n = scale = 100)", () => {
  const s = 40, nu = 250;
  const samples = [20, 50, 80].map(x => ({ x, updated: (nu * s + 100 * x) / (nu + 100) }));
  const f = fitBetaUpdates(s, samples);
  assert.ok(f.valid);
  assert.ok(Math.abs(f.nu - nu) < 1e-9);
  assert.ok(f.diagnostics.rmse < 1e-10);
});
ck("joint fit recovers known concentration when the evidence is out of 20", () => {
  // Estimates out of 100, evidence out of n = 20: a Beta(mu*nu, ...) prior
  // gives 20 new trials the weight 20 / (20 + nu).
  const s = 40, nu = 60, n = 20;
  const samples = [4, 10, 16].map(x => ({ x, updated: s + (n / (n + nu)) * (x * 100 / n - s) }));
  const f = fitBetaUpdates(s, samples, 3, n, 100);
  assert.ok(f.valid);
  assert.ok(Math.abs(f.nu - nu) < 1e-9, `nu=${f.nu}`);
  assert.equal(f.mu, 0.4);
  assert.equal(f.diagnostics.n, 20);
  assert.equal(f.diagnostics.scale, 100);
});
ck("the same updates imply more prior confidence when the evidence was larger", () => {
  // Moving 5 points on 100 trials is a stronger prior than moving 5 points on 20.
  const at = (n) => fitBetaUpdates(40, [20, 50, 80].map(p => ({ x: p * n / 100, updated: 40 + (p - 40) / 4 })), 3, n, 100).nu;
  assert.ok(at(100) > at(20));
});
ck("all answers affect joint fit and diagnostics", () => {
  const a = [{x:20,updated:35},{x:80,updated:50},{x:60,updated:45}];
  assert.notEqual(fitBetaUpdates(40,a).nu, fitBetaUpdates(40,[a[0],a[1],{x:60,updated:49}]).nu);
});
ck("missing responses are not converted to zeros", () => {
  for (const updated of ['', null, undefined, NaN, Infinity]) {
    assert.equal(fitBetaUpdates(40,[{x:20,updated:35},{x:80,updated}]).valid,false);
  }
});
ck("fit bounds are flagged internally with finite quantiles", () => {
  for (const updates of [[40,40],[20,80],[90,0]]) {
    const f=fitBetaUpdates(40,[{x:20,updated:updates[0]},{x:80,updated:updates[1]}]);
    assert.ok(f.valid && f.diagnostics.atBoundary);
    const low=betaQuantile(.25,f.alpha,f.beta), high=betaQuantile(.75,f.alpha,f.beta);
    assert.ok(Number.isFinite(low) && low <= high && high <= 1);
  }
});
ck("boundary estimates are reported as such on either scale", () => {
  for (const s of [0, 100]) assert.equal(fitBetaUpdates(s, [], 3).reason, "boundary_mean");
  assert.equal(fitBetaUpdates(FINE_SCALE, [], 3, FINE_SCALE).reason, "boundary_mean");
  assert.equal(fitBetaUpdates(100, [], 3, FINE_SCALE).reason, "incomplete", "100 is not a boundary out of 10,000");
});

console.log("\n-- stats: update classification --");
for (const [label, args, want] of [
  ["coherent",        [30, 39, 33.5], "toward_evidence"],
  ["no change",       [30, 39, 30],   "no_change"],
  ["copied evidence", [30, 39, 39],   "matched_evidence"],
  ["overshoot",       [30, 39, 50],   "overshoot_past_evidence"],
  ["wrong direction", [30, 39, 20],   "away_from_evidence"],
  ["blank",           [30, 39, NaN],  "not_applicable"],
]) ck(`classify ${label}`, () => assert.equal(classifyUpdate(...args), want));

console.log("\n-- chips --");
ck("an allocation is stored as a count per bin, lowest bin first", () => {
  assert.deepEqual(normaliseChips([1, 2]), [1, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(normaliseChips(undefined), Array(10).fill(0));
  assert.equal(binLabel(0), "0–10%");
  assert.equal(binLabel(9), "90–100%");
});
ck("exactly 20 chips are needed to continue", () => {
  assert.equal(chipsError([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]), null);
  assert.match(chipsError([2, 2, 2]), /14 still to place/);
  assert.match(chipsError(undefined), /20 still to place/);
  assert.match(chipsError([21]), /remove 1/);
  assert.equal(chipsTotal([5, 5, 5, 5]), 20);
});
ck("with answers optional, an untouched widget may be skipped but a partial one may not", () => {
  assert.equal(chipsError(undefined, { allowEmpty: true }), null);
  assert.match(chipsError([3], { allowEmpty: true }), /17 still to place/);
});

console.log("\n-- format --");
ck("integers print bare", () => assert.equal(formatCount(33), "33"));
ck("decimals keep one place", () => assert.equal(formatCount(33.45), "33.5"));
ck("percent rounds", () => assert.equal(formatPercent(0.4312, 0), "43%"));

console.log("\n-- items and pages --");
ck("a question's columns depend on its id only, never its method or position", () => {
  const q = QUESTIONS[0];
  const a = makeQuestionItem(q, { method: "update", updateN: 20 });
  const b = makeQuestionItem(q, { method: "percentiles" });
  assert.equal(a.update.prior, `${q.id}_prior_successes`);
  assert.equal(a.update.n, 20);
  assert.equal(b.percentiles.p50, `${q.id}_p50`);
  assert.equal(a.formatRating, b.formatRating);
  assert.equal(a.boundary.meaning, b.boundary.meaning);
  assert.equal(a.boundary.source, a.update.prior, "Update follows up on the initial estimate");
  assert.equal(b.boundary.source, b.percentiles.p50, "Percentiles follows up on the median");
  assert.equal(makeQuestionItem(q, { method: "chips" }).boundary, null);
});
ck("practice fields are namespaced", () => {
  assert.equal(PRACTICE.update.prior, "practice_prior_successes");
  assert.equal(PRACTICE.percentiles.p10, "practice_p10");
  assert.equal(PRACTICE.chips, "practice_chips");
});

const pagesFor = (variant, seed) => {
  const plan = assignParticipant(QUESTIONS, { variant, rng: seeded(seed) });
  return { plan, section: buildMainSection(plan) };
};
ck("each main question appears in its assigned format, in presentation order", () => {
  for (const v of ["A", "B", "C"]) {
    const { plan, section } = pagesFor(v, 31);
    const names = section.pages.map((p) => p.name);
    const firstPage = { percentiles: "_percentiles", chips: "_chips", update: "_estimate" };
    const starts = plan.main.map((e) => names.indexOf(`${e.id}${firstPage[e.method]}`));
    assert.ok(starts.every((i) => i > 0), `${v}: every question has its first page`);
    assert.deepEqual([...starts].sort((a, b) => a - b), starts, `${v}: pages follow the presentation order`);
    for (const e of plan.main) {
      for (const m of ["percentiles", "chips"]) {
        assert.equal(names.includes(`${e.id}_${m}`), e.method === m, `${v}: ${e.id} ${m} page`);
      }
      assert.equal(names.includes(`${e.id}_estimate`), e.method === "update");
      const page = section.pages.find((p) => p.name === `${e.id}${firstPage[e.method]}`);
      assert.ok(page.title.startsWith(`Question ${e.position} of 6\n`), page.title);
    }
  }
});
ck("a format rating follows every main question, before the next one starts", () => {
  const { plan, section } = pagesFor("A", 37);
  const names = section.pages.map((p) => p.name);
  plan.main.forEach((e, i) => {
    const rating = names.indexOf(`${e.id}_rating`);
    const own = names.map((n, k) => [n, k]).filter(([n]) => n.startsWith(`${e.id}_`) && n !== `${e.id}_rating`).map(([, k]) => k);
    assert.ok(rating > Math.max(...own), `${e.id}: rating comes after its pages`);
    const next = plan.main[i + 1];
    if (next) assert.ok(rating < names.findIndex((n) => n.startsWith(`${next.id}_`)), `${e.id}: rating before the next question`);
    const page = section.pages[rating];
    assert.equal(page.elements.find((el) => el.name === `${e.id}_format_rating`).title, FORMAT_RATING_TITLE);
  });
  assert.equal(names.filter((n) => n.endsWith("_rating")).length, 6);
});
ck("standalone items are interspersed at their configured positions; repeat and comments come last", () => {
  const { plan, section } = pagesFor("C", 41);
  const names = section.pages.map((p) => p.name);
  for (const { id, after } of DIAGNOSTIC_PLACEMENT) {
    const at = names.indexOf(`diag_${id}`);
    const prevRating = names.indexOf(`${plan.main[after - 1].id}_rating`);
    assert.ok(at > prevRating, `${id} after question ${after}`);
    if (after < 6) assert.ok(at < names.findIndex((n) => n.startsWith(`${plan.main[after].id}_`)), `${id} before question ${after + 1}`);
  }
  assert.ok(names.indexOf("consistency_repeat") > names.indexOf(`${plan.main[5].id}_rating`));
  assert.equal(names.at(-1), "final_comments");
});
ck("the consistency repeat reuses the target's scenario as a single point estimate", () => {
  const { plan, section } = pagesFor("B", 43);
  const page = section.pages.find((p) => p.name === "consistency_repeat");
  const target = QUESTIONS.find((q) => q.id === plan.consistencyTarget);
  assert.ok(page.elements.some((el) => el.html === target.scenario));
  const q = page.elements.find((el) => el.name === "consistency_repeat_estimate");
  assert.equal(q.title, "Out of every 100 comparable cases, about how many would you expect to succeed?");
  assert.ok(!JSON.stringify(page).includes(`${target.id}_p50`), "the earlier answer is not shown");
});
ck("shared context: in full first, then a collapsed reminder on every main question page", () => {
  const { plan, section } = pagesFor("A", 47);
  assert.equal(section.pages[0].name, "shared_context");
  const own = section.pages.filter((p) => plan.main.some((e) => p.name.startsWith(`${e.id}_`)));
  for (const p of own) assert.match(p.elements[0].html, /<details class="context-reminder">/, p.name);
});

console.log("\n-- persistence --");
const mkStore = (endpoint, fetchImpl) => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true });
  globalThis.window = { crypto: { randomUUID: () => "fixed-id" } };
  globalThis.fetch = fetchImpl;
  return createStore({ endpoint, surveyVersion: "t", startedAt: new Date().toISOString() });
};
ck("payload flattens the interval into two columns, and arrays into JSON", () => {
  const s = mkStore("https://x.test", async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const p = s.buildPayload({ credible_interval_90: [0.2, 0.4], q_chips: [1, 2, 3] });
  assert.equal(p.ci90_low, 0.2); assert.equal(p.ci90_high, 0.4);
  assert.ok(!("credible_interval_90" in p));
  assert.equal(p.q_chips, "[1,2,3]");
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

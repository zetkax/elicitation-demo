import assert from "node:assert/strict";
import { chooseHypotheticalX, calculateBetaFit, classifyUpdate, betaQuantile, fitBetaUpdates, binomialPmf } from "../src/stats.js";
import { generateEvidence, EVIDENCE_RULE } from "../src/evidence.js";
import { formatCount, formatPercent } from "../src/format.js";
import { assignParticipant, parseVariant, planSummary } from "../src/assignment.js";
import { VARIANTS, DIAGNOSTIC_PLACEMENT, FINE_SCALE } from "../src/design.js";
import { chipsTotal, chipsError, normaliseChips, binLabel, binRange, renderChips } from "../src/chips.js";
import { trainingPages } from "../src/pages/training.js";
import { fitBetaToPercentiles, fitBetaToChips } from "../src/fitting.js";
import { trainingFeedbackHtml, trainingFeedbackMissingHtml } from "../src/chart.js";
import { regularizedIncompleteBeta } from "../src/stats.js";
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

console.log("\n-- smooth approximations (Percentiles, Chips) --");
const q3 = (f) => [f.p10, f.p50, f.p90].map((v) => v * 100);
const sane = (f, label) => {
  assert.ok(f.valid, `${label}: ${f.reason}`);
  assert.ok(f.alpha > 0 && f.beta > 0 && Number.isFinite(f.rmse), label);
  const [a, b, c] = q3(f);
  assert.ok(0 <= a && a <= b && b <= c && c <= 100, `${label}: ${a} ${b} ${c}`);
};
ck("Percentiles: recovers a known distribution from its own 10th/50th/90th percentiles", () => {
  const given = [0.1, 0.5, 0.9].map((p) => betaQuantile(p, 4, 6) * 100);
  const f = fitBetaToPercentiles(...given);
  assert.ok(Math.abs(f.alpha - 4) < 0.01 && Math.abs(f.beta - 6) < 0.01, `${f.alpha} ${f.beta}`);
  assert.ok(f.rmse < 1e-4);
  assert.equal(f.method, "percentiles_cdf_least_squares_v1");
});
ck("Percentiles: a reasonable answer fits closely; the fitted percentiles are the fit's own", () => {
  const f = fitBetaToPercentiles(20, 40, 65);
  sane(f, "20/40/65");
  q3(f).forEach((v, i) => assert.ok(Math.abs(v - [20, 40, 65][i]) < 2, `${v}`));
  // The 80% interval is the fitted 10th-90th percentile.
  assert.equal(f.p10, betaQuantile(0.1, f.alpha, f.beta));
  assert.equal(f.p90, betaQuantile(0.9, f.alpha, f.beta));
});
ck("Percentiles: answers at or near 0 and 100 still fit", () => {
  for (const args of [[0, 1, 5], [0, 0, 0], [95, 99, 100], [100, 100, 100], [0, 50, 100], [40, 40, 40]]) sane(fitBetaToPercentiles(...args), args.join("/"));
  assert.ok(q3(fitBetaToPercentiles(0, 1, 5))[2] < 10);
  assert.ok(q3(fitBetaToPercentiles(95, 99, 100))[0] > 90);
});
ck("Percentiles: missing or out-of-order answers fail gracefully", () => {
  assert.deepEqual(fitBetaToPercentiles("", 40, 60), { valid: false, reason: "incomplete" });
  assert.deepEqual(fitBetaToPercentiles(undefined, null, 60), { valid: false, reason: "incomplete" });
  assert.deepEqual(fitBetaToPercentiles(50, 40, 60), { valid: false, reason: "out_of_order" });
  assert.equal(fitBetaToPercentiles(-1, 40, 60).valid, false);
  assert.equal(fitBetaToPercentiles(10, 40, 160).valid, false);
});
ck("Chips: recovers the shape of a known distribution from its allocation", () => {
  const exact = Array.from({ length: 10 }, (_, i) => 20 * (regularizedIncompleteBeta((i + 1) / 10, 3, 5) - regularizedIncompleteBeta(i / 10, 3, 5)));
  const counts = exact.map(Math.round);
  counts[3] += 20 - counts.reduce((a, b) => a + b, 0);
  const f = fitBetaToChips(counts);
  sane(f, "~Beta(3,5)");
  assert.ok(Math.abs(f.p50 * 100 - betaQuantile(0.5, 3, 5) * 100) < 3, `median ${f.p50 * 100}`);
  assert.equal(f.method, "chips_cdf_least_squares_v1");
});
ck("Chips: uniform, skewed, end-bin and two-peaked allocations all fit sensibly", () => {
  const u = fitBetaToChips([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  sane(u, "uniform");
  q3(u).forEach((v, i) => assert.ok(Math.abs(v - [10, 50, 90][i]) < 0.5, `uniform ${v}`));
  sane(fitBetaToChips([7, 5, 3, 2, 1, 1, 1, 0, 0, 0]), "skewed");
  const low = fitBetaToChips([20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const high = fitBetaToChips([0, 0, 0, 0, 0, 0, 0, 0, 0, 20]);
  sane(low, "all in 0-9"); sane(high, "all in 90-100");
  assert.ok(Math.abs(low.p50 * 100 - 5) < 1 && Math.abs(high.p50 * 100 - 95) < 1, "an end-bin pile centres in its bin");
  sane(fitBetaToChips([0, 0, 0, 0, 20, 0, 0, 0, 0, 0]), "one bin");
  sane(fitBetaToChips([5, 5, 0, 0, 0, 0, 0, 0, 5, 5]), "two peaks");
});
ck("Chips: an incomplete allocation does not fit", () => {
  assert.equal(fitBetaToChips([19]).valid, false);
  assert.equal(fitBetaToChips(undefined).reason, "incomplete");
  assert.equal(fitBetaToChips([21]).valid, false);
});
ck("training feedback: the 80% interval and the middle come from the fitted 10th/50th/90th percentiles", () => {
  const f = fitBetaToPercentiles(20, 40, 65);
  const html = trainingFeedbackHtml(f, { markers: [20, 40, 65] });
  const show = (v) => formatCount(v * 100);
  assert.ok(html.includes(`an <strong>80% chance</strong> that the true number lies between <strong>${show(f.p10)} and ${show(f.p90)} successes out of 100 comparable attempts</strong>.`), html);
  assert.ok(html.includes(`The middle of the fitted distribution is around <strong>${show(f.p50)} successes out of 100</strong>.`));
  assert.match(html, /Based on your answers, this smooth curve approximately represents your uncertainty\./);
  assert.match(html, /Central 80% interval/);
  assert.equal((html.match(/<circle /g) || []).length, 3, "markers at the three numbers given");
  const chips = trainingFeedbackHtml(fitBetaToChips([0, 1, 3, 6, 5, 3, 2, 0, 0, 0]), { histogram: [0, 1, 3, 6, 5, 3, 2, 0, 0, 0] });
  assert.equal((chips.match(/<rect /g) || []).length, 6, "one bar per range with chips");
  assert.match(chips, /Your chips/);
});
ck("participant-facing feedback and training text use no statistical jargon", () => {
  const jargon = /\bbeta\b|alpha|\bpdf\b|\bcdf\b|\bmse\b|confidence interval|50% interval|density/i;
  const f = fitBetaToChips([0, 1, 3, 6, 5, 3, 2, 0, 0, 0]);
  for (const html of [trainingFeedbackHtml(f, { histogram: [0, 1, 3, 6, 5, 3, 2, 0, 0, 0] }), trainingFeedbackHtml(f, { markers: [20, 40, 65] }),
    trainingFeedbackHtml(f), trainingFeedbackMissingHtml("incomplete"), trainingFeedbackMissingHtml("no_fit")]) {
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), jargon);
  }
  const text = JSON.stringify(trainingPages).replace(/<[^>]+>/g, " ").replace(/"name":"[^"]*"/g, "");
  assert.doesNotMatch(text, jargon);
});
ck("training has a feedback picture after each of the three formats", () => {
  const names = trainingPages.map((p) => p.name);
  const hostOn = (page) => JSON.stringify(page).match(/data-feedback=\\"([^"\\]+)/)?.[1];
  assert.equal(hostOn(trainingPages.find((p) => p.name === "practice_percentiles_feedback")), "practice_percentiles");
  assert.equal(hostOn(trainingPages.find((p) => p.name === "practice_chips_feedback")), "practice_chips");
  assert.equal(names[names.indexOf("practice_percentiles") + 1], "practice_percentiles_feedback");
  assert.equal(names[names.indexOf("practice_chips") + 1], "practice_chips_feedback");
  assert.match(JSON.stringify(trainingPages.find((p) => p.name === "practice_fit_check")), /data-fit-check=\\"practice\\"/);
  assert.doesNotMatch(JSON.stringify(trainingPages), /data-edit/, "no revision loop in the training");
});
ck("every main question, in every format, has one feedback page after its answer and before its rating", () => {
  for (const v of ["A", "B", "C"]) {
    const plan = assignParticipant(QUESTIONS, { variant: v, rng: seeded(61) });
    const section = buildMainSection(plan);
    const names = section.pages.map((p) => p.name);
    for (const e of plan.main) {
      const at = names.indexOf(`${e.id}_feedback`);
      assert.ok(at > 0, `${v} ${e.id}: has a feedback page`);
      const page = section.pages[at];
      const json = JSON.stringify(page);
      assert.ok(json.includes(`data-feedback=\\"${e.id}\\"`), "draws this question's curve");
      assert.ok(json.includes(`data-edit=\\"${e.id}\\"`), "offers Edit my answer");
      const q = page.elements.find((el) => el.name === `${e.id}_fit_feedback`);
      assert.equal(q.title, "Does this distribution roughly represent the uncertainty you intended to express?");
      assert.deepEqual(q.choices.map((c) => c.text), ["Yes, it looks about right", "It is too narrow", "It is too wide",
        "The centre is in the wrong place", "Something else"]);
      const first = names.indexOf(`${e.id}${{ percentiles: "_percentiles", chips: "_chips", update: "_estimate" }[e.method]}`);
      assert.ok(first < at && at < names.indexOf(`${e.id}_rating`), `${e.id}: answer, then feedback, then rating`);
      assert.equal(names.filter((n) => n === `${e.id}_rating`).length, 1, "rated once");
      if (e.method === "update") assert.ok(!names.includes(`${e.id}_fit_check`), "the shared page replaces the old fit check");
      for (const own of section.pages.filter((p) => p.name === `${e.id}_percentiles` || p.name === `${e.id}_chips`)) {
        assert.doesNotMatch(JSON.stringify(own), /data-feedback/, "the answer page itself shows no curve");
      }
    }
  }
});

console.log("\n-- chips --");
ck("an allocation is stored as a count per bin, lowest bin first", () => {
  assert.deepEqual(normaliseChips([1, 2]), [1, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(normaliseChips(undefined), Array(10).fill(0));
  assert.equal(binLabel(0), "0–9 out of 100");
  assert.equal(binLabel(1), "10–19 out of 100");
  assert.equal(binLabel(9), "90–100 out of 100");
});
ck("bins are whole numbers of successes out of 100, with no shared endpoints", () => {
  const ranges = Array.from({ length: 10 }, (_, i) => binRange(i));
  assert.deepEqual(ranges[0], [0, 9]);
  assert.deepEqual(ranges[9], [90, 100]);
  ranges.slice(1).forEach(([lo], i) => assert.equal(lo, ranges[i][1] + 1, "each bin starts one after the last ends"));
  for (let i = 0; i < 10; i++) assert.doesNotMatch(binLabel(i), /%/);
});
ck("the widget: + and − move chips, Clear all empties, the count of chips left follows", () => {
  // A stand-in host: renderChips only writes innerHTML and reads clicked buttons.
  const host = { innerHTML: "", querySelector: () => null };
  const changes = [];
  renderChips(host, { value: undefined, onChange: (v) => changes.push(v) });
  const left = () => Number(host.innerHTML.match(/<strong>(\d+)<\/strong> of 20 chips left/)[1]);
  const click = (attrs) => {
    const button = { disabled: false, dataset: attrs, hasAttribute: (a) => a === "data-clear" && attrs.clear, closest: () => button };
    host.onclick({ target: button });
  };
  assert.equal(left(), 20);
  assert.match(host.innerHTML, /data-clear disabled/, "nothing to clear yet");
  click({ bin: "3", step: "1" }); click({ bin: "3", step: "1" }); click({ bin: "7", step: "1" });
  assert.equal(left(), 17);
  assert.deepEqual(changes.at(-1), [0, 0, 0, 2, 0, 0, 0, 1, 0, 0]);
  click({ bin: "3", step: "-1" });
  assert.equal(left(), 18);
  assert.deepEqual(changes.at(-1), [0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  click({ clear: true });
  assert.equal(left(), 20);
  assert.deepEqual(changes.at(-1), Array(10).fill(0));
  // With every chip placed, + is disabled everywhere and Continue is allowed.
  renderChips(host, { value: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], onChange: () => {} });
  assert.equal(left(), 0);
  assert.equal((host.innerHTML.match(/data-step="1"[^>]* disabled/g) || []).length, 10);
  assert.match(host.innerHTML, />90–100 <span class="chips-label-unit">out of 100<\/span>/);
  assert.doesNotMatch(host.innerHTML, /%/, "no percentages in the widget");
  // Histogram layout: one column per range, in order, under one axis title.
  assert.equal((host.innerHTML.match(/class="chips-row"/g) || []).length, 10);
  assert.match(host.innerHTML, /class="chips-axis"[^>]*>Successful attempts out of 100</);
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
  assert.equal(q.title, "Out of every 100 comparable attempts, about how many would you expect to succeed?");
  assert.ok(!JSON.stringify(page).includes(`${target.id}_p50`), "the earlier answer is not shown");
});
ck("Percentiles ask for successes out of 100, not a percentage success rate", () => {
  for (const v of ["A", "B", "C"]) {
    const { plan, section } = pagesFor(v, 53);
    for (const e of plan.main.filter((m) => m.method === "percentiles")) {
      const page = section.pages.find((p) => p.name === `${e.id}_percentiles`);
      for (const key of ["p10", "p50", "p90"]) {
        const q = page.elements.find((el) => el.name === `${e.id}_${key}`);
        assert.match(q.title, /out of 100 comparable attempts, how many would succeed\?$/, q.title);
        assert.doesNotMatch(q.title + q.description, /success rate|\(%\)/, `${key}: no percentage success rate`);
        assert.equal(q.min, 0); assert.equal(q.max, 100);
      }
    }
  }
});
ck("Chips pages use probability wording, about successful attempts out of 100", () => {
  const html = (page) => page.elements.map((el) => el.html || "").join(" ").replace(/\s+/g, " ");
  for (const v of ["A", "B", "C"]) {
    const { plan, section } = pagesFor(v, 59);
    for (const e of plan.main.filter((m) => m.method === "chips")) {
      const text = html(section.pages.find((p) => p.name === `${e.id}_chips`));
      assert.match(text, /Show how uncertain you are about the number of successful attempts\./);
      assert.match(text, /Distribute all 20 chips across the ranges below to show where you think the true number of successes out of 100 comparable attempts is likely to fall\./);
      assert.match(text, /Each chip represents a 5% probability\. Put more chips in ranges you think are more likely\./);
      assert.doesNotMatch(text, /success rate|true rate|of your probability|more certain/);
      assert.doesNotMatch(text, /20% chance/, "the worked example is for the training only");
    }
  }
  const training = html(trainingPages.find((p) => p.name === "practice_chips"));
  assert.match(training, /putting 4 chips in the 30–39 range means you think there is a 20% chance that the true number of successes out of 100 is between 30 and 39\./);
  assert.equal((training.match(/Each chip represents a 5% probability/g) || []).length, 1, "said once on the page");
  assert.doesNotMatch(training, /success rate|true rate|of your probability|more certain/);
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

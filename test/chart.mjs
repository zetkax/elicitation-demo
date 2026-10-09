import assert from 'node:assert/strict';
import { fitSummaryHtml, trainingFeedbackHtml, CHART_STYLES, FIT_INTERVAL } from '../src/chart.js';
import { calculateBetaFit, fitBetaUpdates, betaQuantile } from '../src/stats.js';
import { formatCount } from '../src/format.js';
import { FINE_SCALE, ADAPTIVE_N } from '../src/design.js';

// Both styles: the line by default (a curve and its shaded band), or 20 dots.
const lineHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line');
// The summary is the central 80% interval: the fit's own 10th and 90th
// percentiles, as successes out of 100 -- not the old 25th-75th.
{
  const fit = calculateBetaFit(40, 60, 45);
  assert.deepEqual(FIT_INTERVAL, [0.1, 0.9]);
  const [p10, p90] = [0.1, 0.9].map((p) => formatCount(betaQuantile(p, fit.alpha, fit.beta) * 100));
  const [q25, q75] = [0.25, 0.75].map((p) => formatCount(betaQuantile(p, fit.alpha, fit.beta) * 100));
  const readout = lineHtml.match(/<p class="fit-readout">([\s\S]*?)<\/p>/)[1];
  assert.equal(readout, `The fitted model assigns an 80% chance that the AI's underlying number of successes out of 100 comparable attempts is between <strong>${p10} and ${p90}</strong>.`);
  assert.notEqual(`${p10}-${p90}`, `${q25}-${q75}`, 'the bounds are not the old quartiles');
  assert.match(lineHtml, /Central 80% interval/);
  assert.doesNotMatch(lineHtml, /50%/);
  // The shaded band runs from the 10th to the 90th percentile on the axis.
  const band = lineHtml.match(/<path d="M([\d.]+),160 [\s\S]*? L([\d.]+),160 Z"/);
  const xAt = (v) => 40 + v * 520;
  assert.ok(Math.abs(+band[1] - xAt(betaQuantile(0.1, fit.alpha, fit.beta))) < 0.06);
  assert.ok(Math.abs(+band[2] - xAt(betaQuantile(0.9, fit.alpha, fit.beta))) < 0.06);
}
assert.match(lineHtml, /Central estimate: 40 out of 100/);
// No success-rate percentages: axis ticks and readouts are counts out of 100.
assert.doesNotMatch(lineHtml.replace(/80% (chance|interval)/g, ''), /\d%/);
assert.equal((lineHtml.match(/<path /g) || []).length, 2);
assert.equal((lineHtml.match(/<circle /g) || []).length, 0);
const dotsHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'dots');
assert.equal((dotsHtml.match(/<circle /g) || []).length, 20);
assert.equal((dotsHtml.match(/fill="#263487"/g) || []).length, 16, 'the central 80% is 16 of the 20 dots');
assert.equal((dotsHtml.match(/<path /g) || []).length, 0);
// Both styles share every word; only the note under the chart differs.
const strip = (h) => h.replace(/<svg[\s\S]*<\/svg>/, '').replace(/<p class="fit-note">[\s\S]*?<\/p>/, '');
assert.equal(strip(lineHtml), strip(dotsHtml));
// Near the edge of the scale, a bound just inside it is not rounded onto 0.
{
  const lowBound = (s) => {
    const fit = fitBetaUpdates(s, [{ x: 1, updated: 1 }, { x: 8, updated: 7 }, { x: 15, updated: 13 }], 3, 100, 100);
    return [betaQuantile(0.1, fit.alpha, fit.beta) * 100, fitSummaryHtml(fit, 'line').match(/is between <strong>(.+?) and /)[1]];
  };
  const [p10at2, shownAt2] = lowBound(2);
  assert.ok(p10at2 > 0.005 && p10at2 < 0.05, `estimate 2: p10 ${p10at2}`);
  assert.equal(shownAt2, p10at2.toFixed(2));
  const [p10at1, shownAt1] = lowBound(1);
  assert.ok(p10at1 > 0 && p10at1 < 0.005, `estimate 1: p10 ${p10at1}`);
  assert.equal(shownAt1, '< 0.01');
}
// Fits from the Update format, with evidence out of 20, draw like any other.
const fromTwenty = fitBetaUpdates(40, [{ x: 4, updated: 35 }, { x: 10, updated: 45 }, { x: 16, updated: 52 }], 3, 20, 100);
assert.ok(fromTwenty.valid);
assert.match(fitSummaryHtml(fromTwenty, 'line'), /Central estimate: 40 out of 100/);

// Dots: never overlap, stay inside the plot, and a spread-out belief is not
// flattened to one row -- for every shape from very tight to very wide.
for (const update of [40.2, 41, 45, 50, 55, 59]) {
  const html = fitSummaryHtml(calculateBetaFit(40, 60, update), 'dots');
  const pts = [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(pts.length, 20);
  for (const [x, y, r] of pts) assert.ok(x - r >= 40 && x + r <= 560 && y - r >= 10 && y + r <= 160, `dot off plot at ${update}`);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const gap = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    assert.ok(gap >= 2 * pts[i][2] - 1e-6, `dots overlap at update ${update}`);
  }
}

// Extremes: near-boundary means (density spikes at an edge), and near-zero and
// near-full revisions (very wide and very narrow curves). Neither style may
// emit NaN/Infinity, and every drawn point must stay inside the plot area.
for (const args of [[1,20,2], [99,80,98], [50,80,79.99], [50,80,50.01]]) {
  for (const style of CHART_STYLES) {
    const html = fitSummaryHtml(calculateBetaFit(...args), style);
    assert.ok(!/NaN|Infinity/.test(html), `${style} ${args}: non-finite value`);
    for (const [, x, y] of html.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
      assert.ok(+x >= 40 && +x <= 560 && +y >= 10 && +y <= 160, `${style} ${args}: point ${x},${y} off the plot`);
    }
  }
}

// The fine (out of 10,000) scale: the axis zooms in on a small rate, so the
// curve and the 80% band are drawn across the plot, not as a sliver at 0.
{
  const rare = fitBetaUpdates(5, [{ x: 2, updated: 4 }, { x: 9, updated: 7 }, { x: 12, updated: 8 }], 3, FINE_SCALE);
  assert.ok(rare.valid);
  for (const style of CHART_STYLES) {
    const html = fitSummaryHtml(rare, style, { zoom: true, per: FINE_SCALE, noun: 'failures' });
    assert.ok(!/NaN|Infinity/.test(html), `${style} zoomed: non-finite value`);
    assert.match(html, /an 80% chance that the AI's underlying number of failures out of 10,000 comparable attempts is between/);
    assert.match(html, /Central estimate: 5 out of 10,000/);
    assert.doesNotMatch(html, />10,000</, `${style} zoomed: the axis must not run to 10,000`);
    const xs = [...html.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x]) => +x);
    for (const x of xs) assert.ok(x >= 40 && x <= 560, `${style} zoomed: point at x=${x} off the plot`);
    const band = html.match(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/);
    if (style === 'dots') assert.ok(+band[2] > 20, `the 80% band is drawn wide, not a sliver (${band[2]}px)`);
  }
  // A rate that is not small is drawn on the usual 0-100 axis even when zoom is asked for.
  assert.equal(fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line', { zoom: true }), lineHtml);
}
// The adaptive boundary feedback: counts out of 1,000, zoomed and legible.
{
  const rare = fitBetaUpdates(2, [{ x: 0, updated: 1.5 }, { x: 5, updated: 3 }], 2, ADAPTIVE_N);
  assert.ok(rare.valid);
  for (const noun of ['successes', 'failures']) {
    const html = trainingFeedbackHtml(rare, { per: ADAPTIVE_N, zoom: true, noun });
    assert.ok(!/NaN|Infinity/.test(html));
    assert.match(html, new RegExp(`${noun} out of 1,000`));
    assert.match(html, /axis zoomed in: it shows 0 to [\d.,]+, not the whole range up to 1,000/);
    assert.doesNotMatch(html, />1,000</, 'the axis must not run to 1,000');
    const ticks = [...html.matchAll(/<text[^>]*>([\d.,]+)<\/text>/g)].map(([, t]) => t);
    assert.ok(new Set(ticks).size >= 3, `at least three distinct tick labels (${ticks})`);
    for (const [, x] of html.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) assert.ok(+x >= 40 && +x <= 560);
  }
}

console.log('PASS chart styles, the central 80% interval, shared wording, plot limits, and the zoomed fine-scale axis');

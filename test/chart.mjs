import assert from 'node:assert/strict';
import { renderPracticeExplorer, fitSummaryHtml, CHART_STYLES } from '../src/chart.js';
import { calculateBetaFit, fitBetaUpdates, RARE_N } from '../src/stats.js';
const changes = [], styleChanges = [];
function control() { return { value: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }; }
const number = control(), range = control(), plot = { innerHTML: '' };
const radios = CHART_STYLES.map((s) => Object.assign(control(), { value: s, checked: false }));
const host = {
  innerHTML: '',
  querySelector(selector) { return selector.includes('number') ? number : selector.includes('range') ? range : plot; },
  querySelectorAll() { return radios; },
};
renderPracticeExplorer(host, { prior: 40, evidence: 60, initial: 45, onChange: v => changes.push(v), onChartStyleChange: s => styleChanges.push(s) });
// Toggle markup: one radio per style, with the line pre-selected.
assert.equal((host.innerHTML.match(/type="radio" name="chart-style"/g) || []).length, 2);
assert.match(host.innerHTML, /value="line" checked/);
const initial = plot.innerHTML;
assert.match(initial, /50% chance/);
assert.match(initial, /Central estimate: 40%/);
// Default is the line: a curve and its shaded band, no dots.
assert.equal((initial.match(/<path /g) || []).length, 2);
assert.equal((initial.match(/<circle /g) || []).length, 0);
// The dots style is still available, unchanged.
const dotsHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'dots');
assert.equal((dotsHtml.match(/<circle /g) || []).length, 20);
assert.equal((dotsHtml.match(/<path /g) || []).length, 0);
// Both styles share every word; only the note under the chart differs.
const lineHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line');
const strip = (h) => h.replace(/<svg[\s\S]*<\/svg>/, '').replace(/<p class="fit-note">[\s\S]*?<\/p>/, '');
assert.equal(strip(lineHtml), strip(dotsHtml));
range.value = '55'; range.listeners.input();
assert.equal(number.value, '55');
assert.notEqual(plot.innerHTML, initial);
assert.deepEqual(changes, [55]);
number.value = '40'; number.listeners.input();
// Check that a message card appears, not its wording -- the copy is expected to change.
assert.match(plot.innerHTML, /class="fit-card"/);
assert.ok(!plot.innerHTML.includes('<svg'));
number.value = '45'; number.listeners.input();
assert.equal(plot.innerHTML, initial);
number.value = ''; number.listeners.input();
assert.match(plot.innerHTML, /Enter a number/);
// Switching style redraws the SAME answer in the other style, and reports it.
number.value = '45';
const pick = (s) => { radios.forEach((r) => { r.checked = r.value === s; }); radios.find((r) => r.value === s).listeners.change(); };
pick('dots');
assert.equal(plot.innerHTML, fitSummaryHtml(calculateBetaFit(40, 60, 45), 'dots'));
pick('line');
assert.equal(plot.innerHTML, initial, 'switching back must restore the identical line chart');
assert.deepEqual(styleChanges, ['dots', 'line']);
assert.equal(number.value, '45', 'switching style must not touch the answer');
// A style from an earlier visit is honoured when the page re-renders.
renderPracticeExplorer(host, { prior: 40, evidence: 60, initial: 45, onChange() {}, chartStyle: 'dots' });
assert.match(host.innerHTML, /value="dots" checked/);
assert.equal((plot.innerHTML.match(/<circle /g) || []).length, 20);
// Fixed vertical scale: within one exploration, a more uncertain answer must
// draw LOWER than the submitted one (equal area, spread wider), and a more
// confident one that overflows the scale is labelled as clipped.
const curveTop = (html) => {
  const d = [...html.matchAll(/<path d="([^"]+)" fill="none"/g)][0][1];
  return Math.min(...[...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => +m[1]));
};
renderPracticeExplorer(host, { prior: 40, evidence: 60, initial: 45, onChange: v => changes.push(v) });
const topSubmitted = curveTop(plot.innerHTML);
number.value = '55'; number.listeners.input();
assert.ok(curveTop(plot.innerHTML) > topSubmitted, 'a more uncertain answer must draw lower');
number.value = '45'; number.listeners.input();
assert.equal(curveTop(plot.innerHTML), topSubmitted, 'returning restores the identical drawing');
// The top of the chart is 1.2x the submitted answer's peak, so that curve
// fills 1/1.2 of the 150px plot height (~83%).
const heightShare = (160 - topSubmitted) / 150;
assert.ok(Math.abs(heightShare - 1 / 1.2) < 0.02, `submitted answer fills ${(heightShare * 100).toFixed(0)}%, expected ~83%`);
// A much more confident answer overflows and is flattened at the top edge,
// with no label.
number.value = '40.5'; number.listeners.input();
assert.equal(curveTop(plot.innerHTML), 10, 'an overflowing curve is capped at the top of the plot');
assert.ok(!/continues above/.test(plot.innerHTML), 'no overflow label');

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
// The finer (out of 10,000) scale: the axis zooms in on a small rate, so the
// curve and the 50% band are drawn across the plot, not as a sliver at 0%.
{
  const rare = fitBetaUpdates(5, [{ x: 2, updated: 4 }, { x: 9, updated: 7 }, { x: 3500, updated: 300 }], 3, RARE_N);
  for (const style of CHART_STYLES) {
    const html = fitSummaryHtml(rare, style, { zoom: true, rateName: 'failure rate' });
    assert.ok(!/NaN|Infinity/.test(html), `${style} zoomed: non-finite value`);
    assert.match(html, /underlying failure rate is between/);
    assert.doesNotMatch(html, />100%</, `${style} zoomed: the axis must not run to 100%`);
    const xs = [...html.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x]) => +x);
    for (const x of xs) assert.ok(x >= 40 && x <= 560, `${style} zoomed: point at x=${x} off the plot`);
    const band = html.match(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/) || html.match(/<path d="M([\d.]+),160/);
    if (style === 'dots') assert.ok(+band[2] > 20, `the 50% band is drawn wide, not a sliver (${band[2]}px)`);
  }
  // A rate that is not small is drawn on the usual 0-100% axis even when zoom is asked for.
  assert.equal(fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line', { zoom: true }), fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line'));
}
console.log('PASS explorer redraw, input sync, model limits, recovery, and accessible interval markup');

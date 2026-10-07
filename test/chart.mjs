import assert from 'node:assert/strict';
import { fitSummaryHtml, CHART_STYLES } from '../src/chart.js';
import { calculateBetaFit, fitBetaUpdates } from '../src/stats.js';
import { FINE_SCALE } from '../src/design.js';

// Both styles: the line by default (a curve and its shaded band), or 20 dots.
const lineHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line');
assert.match(lineHtml, /50% chance/);
assert.match(lineHtml, /Central estimate: 40%/);
assert.equal((lineHtml.match(/<path /g) || []).length, 2);
assert.equal((lineHtml.match(/<circle /g) || []).length, 0);
const dotsHtml = fitSummaryHtml(calculateBetaFit(40, 60, 45), 'dots');
assert.equal((dotsHtml.match(/<circle /g) || []).length, 20);
assert.equal((dotsHtml.match(/<path /g) || []).length, 0);
// Both styles share every word; only the note under the chart differs.
const strip = (h) => h.replace(/<svg[\s\S]*<\/svg>/, '').replace(/<p class="fit-note">[\s\S]*?<\/p>/, '');
assert.equal(strip(lineHtml), strip(dotsHtml));
// Fits from the Update format, with evidence out of 20, draw like any other.
const fromTwenty = fitBetaUpdates(40, [{ x: 4, updated: 35 }, { x: 10, updated: 45 }, { x: 16, updated: 52 }], 3, 20, 100);
assert.ok(fromTwenty.valid);
assert.match(fitSummaryHtml(fromTwenty, 'line'), /Central estimate: 40%/);

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
// curve and the 50% band are drawn across the plot, not as a sliver at 0%.
{
  const rare = fitBetaUpdates(5, [{ x: 2, updated: 4 }, { x: 9, updated: 7 }, { x: 12, updated: 8 }], 3, FINE_SCALE);
  assert.ok(rare.valid);
  for (const style of CHART_STYLES) {
    const html = fitSummaryHtml(rare, style, { zoom: true, rateName: 'failure rate' });
    assert.ok(!/NaN|Infinity/.test(html), `${style} zoomed: non-finite value`);
    assert.match(html, /underlying failure rate is between/);
    assert.doesNotMatch(html, />100%</, `${style} zoomed: the axis must not run to 100%`);
    const xs = [...html.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x]) => +x);
    for (const x of xs) assert.ok(x >= 40 && x <= 560, `${style} zoomed: point at x=${x} off the plot`);
    const band = html.match(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/);
    if (style === 'dots') assert.ok(+band[2] > 20, `the 50% band is drawn wide, not a sliver (${band[2]}px)`);
  }
  // A rate that is not small is drawn on the usual 0-100% axis even when zoom is asked for.
  assert.equal(fitSummaryHtml(calculateBetaFit(40, 60, 45), 'line', { zoom: true }), lineHtml);
}
console.log('PASS chart styles, shared wording, plot limits, and the zoomed fine-scale axis');

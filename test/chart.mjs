import assert from 'node:assert/strict';
import { renderPracticeExplorer, fitSummaryHtml } from '../src/chart.js';
import { calculateBetaFit } from '../src/stats.js';
const changes = [];
function control() { return { value: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }; }
const number = control(), range = control(), plot = { innerHTML: '' };
const host = { innerHTML: '', querySelector(selector) { return selector.includes('number') ? number : selector.includes('range') ? range : plot; } };
renderPracticeExplorer(host, { prior: 40, evidence: 60, initial: 45, onChange: v => changes.push(v) });
const initial = plot.innerHTML;
assert.match(initial, /50% chance/);
assert.match(initial, /Central estimate: 40%/);
assert.equal((initial.match(/<circle /g) || []).length, 20);
range.value = '55'; range.listeners.input();
assert.equal(number.value, '55');
assert.notEqual(plot.innerHTML, initial);
assert.deepEqual(changes, [55]);
number.value = '40'; number.listeners.input();
assert.match(plot.innerHTML, /limitation/);
assert.ok(!plot.innerHTML.includes('<svg'));
number.value = '45'; number.listeners.input();
assert.equal(plot.innerHTML, initial);
number.value = ''; number.listeners.input();
assert.match(plot.innerHTML, /Enter a number/);
for (const args of [[1,20,2], [99,80,98], [50,80,79.99], [50,80,50.01]]) {
  const html = fitSummaryHtml(calculateBetaFit(...args));
  assert.ok(!/NaN|Infinity/.test(html));
}
console.log('PASS explorer redraw, input sync, model limits, recovery, and accessible interval markup');

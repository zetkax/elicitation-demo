import { betaQuantile, calculateBetaFit } from './stats.js';
import { formatPercent } from './format.js';

/** Equal-probability dots; the shaded band is the central 50%, not a density axis. */
export function fitSummaryHtml(fit) {
  const lower = betaQuantile(0.25, fit.alpha, fit.beta);
  const upper = betaQuantile(0.75, fit.alpha, fit.beta);
  const width = upper - lower;
  const concentration = width < 0.1 ? 'relatively concentrated' : width < 0.3 ? 'moderately spread out' : 'widely spread out';
  const bins = new Map();
  const dots = Array.from({ length: 20 }, (_, i) => {
    const value = betaQuantile((i + 0.5) / 20, fit.alpha, fit.beta);
    const bin = Math.min(49, Math.floor(value * 50));
    const stack = bins.get(bin) || 0;
    bins.set(bin, stack + 1);
    return `<circle cx="${40 + value * 520}" cy="${150 - stack * 7}" r="3" fill="${i >= 5 && i < 15 ? '#263487' : '#8a8a92'}"/>`;
  }).join('');
  return `<section class="fit-card"><h3>Implied Beta prior</h3>
    <p class="fit-readout">The fitted model assigns a 50% chance that the AI's underlying success rate is between <strong>${formatPercent(lower)} and ${formatPercent(upper)}</strong>.</p>
    <p>This fitted distribution is ${concentration}. It describes uncertainty about the success rate before the imagined evidence.</p>
    <svg class="beta-chart" viewBox="0 0 600 205" role="img" aria-label="Central estimate ${formatPercent(fit.mu)}; central 50 percent interval ${formatPercent(lower)} to ${formatPercent(upper)}">
      <rect x="${40 + lower * 520}" y="10" width="${Math.max(0.3, width * 520)}" height="150" fill="#ecedfb"/>
      ${dots}<line x1="${40 + fit.mu * 520}" x2="${40 + fit.mu * 520}" y1="10" y2="160" stroke="#1c1c1e" stroke-width="2"/>
      <line x1="40" x2="560" y1="160" y2="160" stroke="#6b6b73"/>
      ${[0,25,50,75,100].map(v => `<text x="${40 + v * 5.2}" y="183" text-anchor="middle" font-size="14" fill="#3f3f46">${v}%</text>`).join('')}
    </svg>
    <div class="chart-legend"><span><i class="legend-swatch legend-swatch--mean"></i>Central estimate: ${formatPercent(fit.mu)}</span>
      <span><i class="legend-swatch legend-swatch--interval"></i>Central 50% interval</span></div>
    <p class="fit-note">Underlying success rate · Each dot represents 5% of the fitted probability. This is a model interpretation, not an assessment of your answer.</p></section>`;
}

export function renderPracticeExplorer(host, { prior, evidence, initial, explored, onChange }) {
  host.innerHTML = `<p>Your original estimate: <strong>${prior} / 100</strong>. Imagined result: <strong>${evidence} / 100</strong>.</p>
    <p>Your submitted practice update is saved. Explore how changing it changes the model's interpretation; there is no target shape.</p>
    <div class="practice-control"><label for="practice-update-number">Explore an updated estimate (out of 100)</label>
    <input id="practice-update-number" type="number" min="0" max="100" step="any">
    <input aria-label="Explore updated estimate using slider" type="range" min="0" max="100" step="0.1"></div>
    <div data-practice-plot aria-live="polite"></div>`;
  const number = host.querySelector('input[type="number"]');
  const range = host.querySelector('input[type="range"]');
  const plot = host.querySelector('[data-practice-plot]');
  function draw(value) {
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      plot.innerHTML = '<p>Enter a number from 0 to 100 to explore the model.</p>';
      return;
    }
    const fit = calculateBetaFit(prior, evidence, value);
    plot.innerHTML = fit.valid ? fitSummaryHtml(fit) : `<section class="fit-card"><p>This pair of answers cannot be represented by a finite Beta prior with your central estimate. That is a limitation of this model, not a score for your answer.</p><p>You can explore other updates or continue with your submitted answer unchanged.</p></section>`;
  }
  const value = explored ?? initial;
  number.value = value;
  range.value = value;
  draw(value);
  for (const control of [number, range]) control.addEventListener('input', () => {
    const value = control.value;
    if (control === range) number.value = value;
    else if (value !== '' && Number(value) >= 0 && Number(value) <= 100) range.value = value;
    draw(value);
    if (value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) onChange(Number(value));
  });
}

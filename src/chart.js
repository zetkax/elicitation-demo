import { betaQuantile, betaDensity, calculateBetaFit } from './stats.js';
import { formatPercent } from './format.js';

/**
 * Two ways of drawing the same fitted distribution, kept side by side so they
 * can be compared. Everything except the plot itself -- wording, the 50% band,
 * the central-estimate line and the axis -- is shared, so a preference between
 * them is about the drawing and nothing else.
 *   "line"  the density curve, shaded under the central 50%   (default)
 *   "dots"  20 equal-probability dots over a shaded 50% band
 */
export const CHART_STYLES = ['line', 'dots'];
const CHART_LABELS = { line: 'Line', dots: 'Dots' };

// Plot area inside the 600x205 viewBox: success rate 0-1 runs left to right.
const PLOT = { left: 40, width: 520, top: 10, bottom: 160 };
const xAt = (v) => PLOT.left + v * PLOT.width;

/**
 * Equal-probability dot plot: 20 dots, each 5% of the fitted probability.
 *
 * Columns are exactly one dot-spacing wide and each dot sits at its column's
 * centre, so dots never overlap and a column's height is proportional to the
 * probability in it. The vertical scale is therefore fixed by construction:
 * the same belief always stacks to the same height, whatever else is shown.
 */
const DOT = { r: 3, step: 7 }; // step = centre-to-centre spacing, across and up
const DOT_COLUMNS = Math.floor(PLOT.width / DOT.step);

function dotsSvg(fit, lower, upper) {
  const colWidth = PLOT.width / DOT_COLUMNS;
  const stacks = new Map();
  const dots = Array.from({ length: 20 }, (_, i) => {
    const value = betaQuantile((i + 0.5) / 20, fit.alpha, fit.beta);
    const col = Math.min(DOT_COLUMNS - 1, Math.max(0, Math.floor(value * DOT_COLUMNS)));
    const stack = stacks.get(col) || 0;
    stacks.set(col, stack + 1);
    const cx = PLOT.left + (col + 0.5) * colWidth;
    const cy = PLOT.bottom - DOT.r - 1 - stack * DOT.step;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${DOT.r}" fill="${i >= 5 && i < 15 ? '#263487' : '#8a8a92'}"/>`;
  }).join('');
  return `<rect x="${xAt(lower).toFixed(1)}" y="${PLOT.top}" width="${Math.max(0.3, (upper - lower) * PLOT.width).toFixed(1)}" height="${PLOT.bottom - PLOT.top}" fill="#ecedfb"/>${dots}`;
}

// Uniform samples across the range, plus dense ones around the mean so a
// narrow peak is drawn smoothly rather than as a spike between two samples.
function curveSamples(fit) {
  const sd = Math.sqrt((fit.mu * (1 - fit.mu)) / (fit.alpha + fit.beta + 1));
  return [
    ...Array.from({ length: 401 }, (_, i) => 0.0025 + (0.995 * i) / 400),
    ...Array.from({ length: 121 }, (_, i) => fit.mu + sd * (-5 + (10 * i) / 120)),
  ].filter((v) => v > 0 && v < 1).sort((a, b) => a - b);
}

/**
 * The tallest point of the curve, used to set a vertical scale. If the density
 * shoots to infinity at 0 or 1 (alpha or beta below 1) that spike is ignored,
 * so it cannot flatten the rest of the curve; it runs off the top instead.
 */
export function peakDensity(fit) {
  const interior = curveSamples(fit)
    .filter((v) => v > 0.02 && v < 0.98)
    .map((v) => betaDensity(v, fit.alpha, fit.beta))
    .filter(Number.isFinite);
  return Math.max(...interior) || 1;
}

/**
 * Density curve; the shaded area under it is the central 50%.
 *
 * `yMax` is the density at the top of the plot. Hold it fixed across redraws
 * and the curves are on one scale: a more uncertain belief is genuinely lower
 * and wider, as it must be, since the area under every curve is 1. Omit it and
 * the curve is scaled to fill the plot, which is only right for a single chart.
 */
function lineSvg(fit, lower, upper, yMax = peakDensity(fit)) {
  const xs = curveSamples(fit);
  const density = (v) => betaDensity(v, fit.alpha, fit.beta);
  const yAt = (v) => PLOT.bottom - Math.min(1, density(v) / yMax) * (PLOT.bottom - PLOT.top);
  const pt = (v) => `${xAt(v).toFixed(1)},${yAt(v).toFixed(1)}`;

  const curve = xs.map((v, i) => `${i ? 'L' : 'M'}${pt(v)}`).join(' ');
  const bandXs = Array.from({ length: 81 }, (_, i) => lower + ((upper - lower) * i) / 80);
  const band = `M${xAt(lower).toFixed(1)},${PLOT.bottom} ${bandXs.map((v) => `L${pt(v)}`).join(' ')} L${xAt(upper).toFixed(1)},${PLOT.bottom} Z`;

  // A belief more confident than the scale allows is clipped flat at the top
  // (yAt caps at 1). Deliberately unlabelled.
  return `<path d="${band}" fill="#ecedfb"/>
      <path d="${curve}" fill="none" stroke="#263487" stroke-width="2.5" stroke-linejoin="round"/>`;
}

const PLOTS = {
  line: { draw: lineSvg, note: '<p>The higher the line, the more plausible that success rate is under the fitted model.</p>' },
  dots: { draw: dotsSvg, note: '<p>Each dot represents 5% of the fitted probability.</p>' },
};

/**
 * @param fit    a valid fit from calculateBetaFit
 * @param style  "line" | "dots"
 * @param opts.yMax  line only: density at the top of the plot (see lineSvg)
 */
export function fitSummaryHtml(fit, style = 'line', { yMax } = {}) {
  const plot = PLOTS[style] || PLOTS.line;
  const lower = betaQuantile(0.25, fit.alpha, fit.beta);
  const upper = betaQuantile(0.75, fit.alpha, fit.beta);
  const width = upper - lower;
  const concentration = width < 0.1 ? 'relatively concentrated' : width < 0.3 ? 'moderately spread out' : 'widely spread out';
  return `<section class="fit-card"><h3>What your answers imply</h3>
    <p class="fit-readout">The fitted model assigns a 50% chance that the AI's underlying success rate is between <strong>${formatPercent(lower)} and ${formatPercent(upper)}</strong>.</p>
    <p>This fitted distribution is ${concentration}. It describes uncertainty about the success rate before the imagined evidence.</p>
    <svg class="beta-chart" viewBox="0 0 600 205" role="img" aria-label="Central estimate ${formatPercent(fit.mu)}; central 50 percent interval ${formatPercent(lower)} to ${formatPercent(upper)}">
      ${plot.draw(fit, lower, upper, yMax)}
      <line x1="${xAt(fit.mu)}" x2="${xAt(fit.mu)}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#1c1c1e" stroke-width="2"/>
      <line x1="${PLOT.left}" x2="${PLOT.left + PLOT.width}" y1="${PLOT.bottom}" y2="${PLOT.bottom}" stroke="#6b6b73"/>
      ${[0,25,50,75,100].map(v => `<text x="${40 + v * 5.2}" y="183" text-anchor="middle" font-size="14" fill="#3f3f46">${v}%</text>`).join('')}
    </svg>
    <div class="chart-legend"><span><i class="legend-swatch legend-swatch--mean"></i>Central estimate: ${formatPercent(fit.mu)}</span>
      <span><i class="legend-swatch legend-swatch--interval"></i>Central 50% interval</span></div>
    <p class="fit-note">Underlying success rate ${plot.note}</p></section>`;
}

// Reference labels under the explorer slider, every 10 of the 0-100 scale.
const SCALE_TICKS = Array.from({ length: 11 }, (_, i) => i * 10);

export function renderPracticeExplorer(host, {
  prior, evidence, initial, explored, onChange, chartStyle = 'line', onChartStyleChange = () => {},
}) {
  let style = CHART_STYLES.includes(chartStyle) ? chartStyle : 'line';
  // One vertical scale for the whole exploration, so moving the slider shows
  // the curve truly flattening or sharpening instead of being rescaled each
  // time. The top of the chart is HEADROOM x the peak of the answer they
  // submitted, so that curve fills ~83% of the height. Answers more confident
  // than that are flattened at the top. If the submitted answer cannot be
  // fitted, the first answer that can sets the scale instead.
  const HEADROOM = 1.2;
  const submitted = calculateBetaFit(prior, evidence, initial);
  let yMax = submitted.valid ? peakDensity(submitted) * HEADROOM : null;
  host.innerHTML = `<p>Your original estimate: <strong>${prior} / 100</strong>. Imagined result: <strong>${evidence} / 100</strong>.</p>
    <p>Your submitted practice update is saved. Explore how changing it changes the model's interpretation; there is no target shape.</p>
    <div class="practice-control"><label for="practice-update-number">Explore an updated estimate (out of 100)</label>
    <input id="practice-update-number" type="number" min="0" max="100" step="any">
    <div class="practice-slider">
      <input aria-label="Explore updated estimate using slider" type="range" min="0" max="100" step="0.1" list="practice-ticks">
      <datalist id="practice-ticks">${SCALE_TICKS.map((v) => `<option value="${v}"></option>`).join('')}</datalist>
      <div class="practice-scale" aria-hidden="true">${SCALE_TICKS.map((v) =>
        `<span class="${v % 20 ? 'practice-scale__minor' : ''}" style="--at:${v}">${v}</span>`).join('')}</div>
    </div></div>
    <fieldset class="chart-toggle"><legend>Show the chart as</legend>
      ${CHART_STYLES.map((s) => `<label><input type="radio" name="chart-style" value="${s}"${s === style ? ' checked' : ''}> ${CHART_LABELS[s]}</label>`).join('')}
    </fieldset>
    <div data-practice-plot aria-live="polite"></div>`;
  const number = host.querySelector('input[type="number"]');
  const range = host.querySelector('input[type="range"]');
  const plot = host.querySelector('[data-practice-plot]');
  // Switching style redraws the same answer, so the two pictures are compared
  // on identical numbers.
  for (const radio of host.querySelectorAll('input[name="chart-style"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      style = radio.value;
      draw(number.value);
      onChartStyleChange(style);
    });
  }
  function draw(value) {
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      plot.innerHTML = '<p>Enter a number from 0 to 100 to explore the model.</p>';
      return;
    }
    const fit = calculateBetaFit(prior, evidence, value);
    if (fit.valid && yMax === null) yMax = peakDensity(fit) * HEADROOM;
    plot.innerHTML = fit.valid ? fitSummaryHtml(fit, style, { yMax }) :`<section class="fit-card"><p><b>This updated estimate falls outside the range between your original estimate and the hypothetical result.</b></p><p>
In this exercise, the hypothetical evidence is assumed to come from the same process as the attempts you are predicting. Under the update model used here, the new estimate should move toward the hypothetical result, but not beyond it.</section>`;
  }
  const value = explored ?? initial;
  number.value = value;
  range.value = value;
  draw(value);
  const inRange = (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  for (const control of [number, range]) control.addEventListener('input', () => {
    const value = control.value;
    if (control === range) number.value = value;
    else if (inRange(value)) range.value = value;
    draw(value);
    if (inRange(value)) onChange(Number(value));
  });
}

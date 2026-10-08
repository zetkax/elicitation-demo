import { betaQuantile, betaDensity } from './stats.js';
import { formatCount, niceTicks } from './format.js';

/**
 * Two ways of drawing the same fitted distribution, kept side by side so they
 * can be compared. Everything except the plot itself -- wording, the 50% band,
 * the central-estimate line and the axis -- is shared, so a preference between
 * them is about the drawing and nothing else.
 *   "line"  the density curve, shaded under the central 50%   (default)
 *   "dots"  20 equal-probability dots over a shaded 50% band
 */
export const CHART_STYLES = ['line', 'dots'];

// Plot area inside the 600x205 viewBox: the rate runs left to right from 0 to
// xMax -- 1 except on the zoomed finer-scale chart (see fitSummaryHtml).
const PLOT = { left: 40, width: 520, top: 10, bottom: 160 };
const xAt = (v, xMax = 1) => PLOT.left + (v / xMax) * PLOT.width;

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

function dotsSvg(fit, lower, upper, _yMax, xMax = 1) {
  const colWidth = PLOT.width / DOT_COLUMNS;
  const stacks = new Map();
  const dots = Array.from({ length: 20 }, (_, i) => {
    const value = betaQuantile((i + 0.5) / 20, fit.alpha, fit.beta);
    const col = Math.min(DOT_COLUMNS - 1, Math.max(0, Math.floor((value / xMax) * DOT_COLUMNS)));
    const stack = stacks.get(col) || 0;
    stacks.set(col, stack + 1);
    const cx = PLOT.left + (col + 0.5) * colWidth;
    const cy = PLOT.bottom - DOT.r - 1 - stack * DOT.step;
    // The middle 16 of the 20 dots are the central 80%.
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${DOT.r}" fill="${i >= 2 && i < 18 ? '#263487' : '#8a8a92'}"/>`;
  }).join('');
  return `<rect x="${xAt(lower, xMax).toFixed(1)}" y="${PLOT.top}" width="${Math.max(0.3, ((upper - lower) / xMax) * PLOT.width).toFixed(1)}" height="${PLOT.bottom - PLOT.top}" fill="#ecedfb"/>${dots}`;
}

// Uniform samples across the range, plus dense ones around the mean so a
// narrow peak is drawn smoothly rather than as a spike between two samples.
function curveSamples(fit, xMax = 1) {
  const sd = Math.sqrt((fit.mu * (1 - fit.mu)) / (fit.alpha + fit.beta + 1));
  return [
    ...Array.from({ length: 401 }, (_, i) => (0.0025 + (0.995 * i) / 400) * xMax),
    ...Array.from({ length: 121 }, (_, i) => fit.mu + sd * (-5 + (10 * i) / 120)),
  ].filter((v) => v > 0 && v < 1 && v <= xMax).sort((a, b) => a - b);
}

/**
 * The tallest point of the curve, used to set a vertical scale. If the density
 * shoots to infinity at 0 or 1 (alpha or beta below 1) that spike is ignored,
 * so it cannot flatten the rest of the curve; it runs off the top instead.
 */
export function peakDensity(fit, xMax = 1) {
  const interior = curveSamples(fit, xMax)
    .filter((v) => v > 0.02 * xMax && v < 0.98 * xMax)
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
function lineSvg(fit, lower, upper, yMax, xMax = 1) {
  const { band, curve } = lineParts(fit, lower, upper, yMax || peakDensity(fit, xMax), xMax);
  return band + curve;
}

// The shaded band under the curve between `lower` and `upper`, and the curve
// itself, as separate SVG paths so other layers can sit between them.
function lineParts(fit, lower, upper, yMax, xMax = 1) {
  const xs = curveSamples(fit, xMax);
  const density = (v) => betaDensity(v, fit.alpha, fit.beta);
  const yAt = (v) => PLOT.bottom - Math.min(1, density(v) / yMax) * (PLOT.bottom - PLOT.top);
  const pt = (v) => `${xAt(v, xMax).toFixed(1)},${yAt(v).toFixed(1)}`;

  const curve = xs.map((v, i) => `${i ? 'L' : 'M'}${pt(v)}`).join(' ');
  const bandXs = Array.from({ length: 81 }, (_, i) => lower + ((upper - lower) * i) / 80);
  const band = `M${xAt(lower, xMax).toFixed(1)},${PLOT.bottom} ${bandXs.map((v) => `L${pt(v)}`).join(' ')} L${xAt(upper, xMax).toFixed(1)},${PLOT.bottom} Z`;

  // A belief more confident than the scale allows is clipped flat at the top
  // (yAt caps at 1). Deliberately unlabelled.
  return { band: `<path d="${band}" fill="#ecedfb"/>`,
    curve: `<path d="${curve}" fill="none" stroke="#263487" stroke-width="2.5" stroke-linejoin="round"/>` };
}

const PLOTS = {
  line: { draw: lineSvg, note: () => '<p>The higher the line, the more plausible that number is under the fitted model.</p>' },
  dots: { draw: dotsSvg, note: () => '<p>Each dot represents 5% of the fitted probability.</p>' },
};

/**
 * Axes and readouts are counts out of `per` comparable attempts (100, or
 * 10,000 on the fine scale), the same framing as Percentiles and Chips, so
 * the only percentages in the card are probabilities.
 */
const defaultAxis = (per) => ({ xMax: 1, ticks: [0, 0.25, 0.5, 0.75, 1],
  tickLabel: (v) => String(Math.round(v * per)), readout: (v) => countText(v * per, per) });

// One decimal, except that a bound strictly inside the scale is not shown as
// exactly 0 or the maximum: 0.034 reads "0.03" and 99.966 "99.97"; anything
// closer to the edge (common for an estimate of 1 or 2) reads "< 0.01".
function countText(count, per) {
  const shown = formatCount(count);
  if (count > 0 && Number(shown) === 0) return count >= 0.005 ? count.toFixed(2) : '< 0.01';
  if (count < per && Number(shown) === per) return per - count >= 0.005 ? count.toFixed(2) : `> ${per - 0.01}`;
  return shown;
}

/**
 * The zoomed axis for the finer (out of 10,000) scale: from 0 to a round
 * number just past nearly all of the belief, so 5 in 10,000 is not drawn as
 * a sliver against the left edge of the full scale. Tick labels carry as many
 * decimals as the step needs; readouts use two significant figures.
 */
function zoomedAxis(fit, per) {
  const { ticks, step } = niceTicks(betaQuantile(0.995, fit.alpha, fit.beta), 4);
  if (ticks.at(-1) >= 0.5) return defaultAxis(per);
  const digits = Math.max(0, Math.ceil(-Math.log10(step * per) - 1e-9));
  return { zoomed: true, xMax: ticks.at(-1), ticks,
    tickLabel: (v) => Number((v * per).toFixed(digits)).toLocaleString('en-US'),
    readout: (v) => Number((v * per).toPrecision(2)).toLocaleString('en-US') };
}

// Spread is judged on the quartiles (the 25th-75th percentile range, which
// these thresholds were set for), on an absolute scale normally; for a very
// small rate, by how many times larger the upper quartile is than the lower.
function concentrationOf(lower, upper, zoomed) {
  if (!zoomed) {
    const width = upper - lower;
    return width < 0.1 ? 'relatively concentrated' : width < 0.3 ? 'moderately spread out' : 'widely spread out';
  }
  const ratio = upper / Math.max(lower, Number.MIN_VALUE);
  return ratio < 1.5 ? 'relatively concentrated' : ratio < 4 ? 'moderately spread out' : 'widely spread out';
}

/**
 * The fitted distribution, summarised by its central 80% interval -- from its
 * 10th to its 90th percentile -- so it compares directly with the 10th-90th
 * percentile range asked for in the Percentiles format.
 *
 * @param fit    a valid fit (alpha, beta, mu), e.g. from fitBetaUpdates
 * @param style  "line" | "dots"
 * @param opts.yMax  line only: density at the top of the plot (see lineSvg)
 * @param opts.zoom  zoom the axis in on a small rate (the finer scale)
 * @param opts.per   what the counts are out of (100, or 10,000 on the fine scale)
 * @param opts.noun  what is counted, e.g. "failures" on the fine scale after 100
 */
export const FIT_INTERVAL = [0.1, 0.9];
export function fitSummaryHtml(fit, style = 'line', { yMax, zoom = false, per = 100, noun = 'successes' } = {}) {
  const plot = PLOTS[style] || PLOTS.line;
  const axis = zoom ? zoomedAxis(fit, per) : defaultAxis(per);
  const { xMax, readout } = axis;
  const [lower, upper] = FIT_INTERVAL.map((p) => betaQuantile(p, fit.alpha, fit.beta));
  const concentration = concentrationOf(betaQuantile(0.25, fit.alpha, fit.beta), betaQuantile(0.75, fit.alpha, fit.beta), Boolean(axis.zoomed));
  const quantity = `number of ${noun} out of ${per.toLocaleString('en-US')} comparable attempts`;
  return `<section class="fit-card"><h3>What your answers imply</h3>
    <p class="fit-readout">The fitted model assigns an 80% chance that the AI's underlying ${quantity} is between <strong>${readout(lower)} and ${readout(upper)}</strong>.</p>
    <p>This fitted distribution is ${concentration}. It describes uncertainty about the ${quantity} before the imagined evidence.</p>
    <svg class="beta-chart" viewBox="0 0 600 205" role="img" aria-label="Central estimate ${readout(fit.mu)} ${noun} out of ${per.toLocaleString('en-US')}; central 80 percent interval ${readout(lower)} to ${readout(upper)}">
      ${plot.draw(fit, lower, upper, yMax, xMax)}
      <line x1="${xAt(fit.mu, xMax)}" x2="${xAt(fit.mu, xMax)}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#1c1c1e" stroke-width="2"/>
      <line x1="${PLOT.left}" x2="${PLOT.left + PLOT.width}" y1="${PLOT.bottom}" y2="${PLOT.bottom}" stroke="#6b6b73"/>
      ${axis.ticks.map(v => `<text x="${40 + (v / xMax) * 520}" y="183" text-anchor="middle" font-size="14" fill="#3f3f46">${axis.tickLabel(v)}</text>`).join('')}
    </svg>
    <div class="chart-legend"><span><i class="legend-swatch legend-swatch--mean"></i>Central estimate: ${readout(fit.mu)} out of ${per.toLocaleString('en-US')}</span>
      <span><i class="legend-swatch legend-swatch--interval"></i>Central 80% interval</span></div>
    <p class="fit-note">Underlying number of ${noun} out of ${per.toLocaleString('en-US')} ${plot.note()}</p></section>`;
}

/* ---------- Training feedback ---------- */

/**
 * After each practice format, the uncertainty the answers imply, drawn the
 * same way for all three: a smooth curve over successes out of 100, its
 * central 80% shaded (the fitted 10th to 90th percentile), and a line at its
 * median. Chips adds the participant's own histogram behind the curve;
 * Percentiles adds markers at the three numbers they gave. No statistical
 * vocabulary: the participant only needs to read "more likely here".
 *
 * @param fit  { alpha, beta } from fitting.js or fitBetaUpdates
 * @param opts.histogram  chip counts per bin, lowest first (Chips)
 * @param opts.markers    [p10, p50, p90] as given, out of 100 (Percentiles)
 */
export function trainingFeedbackHtml(fit, { histogram, markers } = {}) {
  const per = 100;
  const [lower, median, upper] = [FIT_INTERVAL[0], 0.5, FIT_INTERVAL[1]].map((p) => betaQuantile(p, fit.alpha, fit.beta));
  const show = (v) => countText(v * per, per);
  // Chip bars on the curve's own scale: each bin's share divided by its width.
  const bins = histogram ? histogram.length : 0;
  const total = histogram ? histogram.reduce((a, b) => a + b, 0) : 0;
  const barDensity = histogram ? histogram.map((c) => (total ? c / total : 0) * bins) : [];
  const yMax = Math.max(peakDensity(fit), ...barDensity) * 1.08;
  const height = PLOT.bottom - PLOT.top;
  const bars = barDensity.map((d, i) => {
    const h = Math.min(1, d / yMax) * height;
    return h > 0 ? `<rect x="${(xAt(i / bins) + 1).toFixed(1)}" y="${(PLOT.bottom - h).toFixed(1)}" width="${(PLOT.width / bins - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#dcdce0"/>` : '';
  }).join('');
  // The 80% band is translucent and drawn over the chip bars, so both show.
  const { band: solidBand, curve } = lineParts(fit, lower, upper, yMax);
  const band = solidBand.replace('fill="#ecedfb"', 'fill="#263487" fill-opacity="0.13"');
  const marks = (markers || []).filter(Number.isFinite).map((m) =>
    `<circle cx="${xAt(m / per).toFixed(1)}" cy="${PLOT.bottom}" r="5" fill="#fff" stroke="#1c1c1e" stroke-width="2"/>`).join('');
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);
  return `<section class="fit-card feedback-card"><h3>Based on your answers, this smooth curve approximately represents your uncertainty.</h3>
    <p class="fit-readout">Based on your answers, the model estimates an <strong>80% chance</strong> that the true number lies between <strong>${show(lower)} and ${show(upper)} successes out of 100 comparable attempts</strong>.</p>
    <p>The middle of the fitted distribution is around <strong>${show(median)} successes out of 100</strong>.</p>
    <svg class="beta-chart" viewBox="0 0 600 205" role="img" aria-label="Smooth curve over successes out of 100; 80 percent of it between ${show(lower)} and ${show(upper)}; middle at ${show(median)}">
      ${bars}${band}${curve}
      <line x1="${xAt(median).toFixed(1)}" x2="${xAt(median).toFixed(1)}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#1c1c1e" stroke-width="2"/>
      <line x1="${PLOT.left}" x2="${PLOT.left + PLOT.width}" y1="${PLOT.bottom}" y2="${PLOT.bottom}" stroke="#6b6b73"/>
      ${marks}
      ${ticks.map((v) => `<text x="${xAt(v / per)}" y="183" text-anchor="middle" font-size="14" fill="#3f3f46">${v}</text>`).join('')}
    </svg>
    <div class="chart-legend">
      <span><i class="legend-swatch legend-swatch--mean"></i>Middle: ${show(median)}</span>
      <span><i class="legend-swatch legend-swatch--interval"></i>Central 80% interval</span>
      ${histogram ? '<span><i class="legend-swatch legend-swatch--chips"></i>Your chips</span>' : ''}
      ${markers ? '<span><i class="legend-swatch legend-swatch--answer"></i>Your three numbers</span>' : ''}
    </div>
    <p class="fit-note">Successes out of 100 comparable attempts. The higher the curve, the more likely that number is.</p></section>`;
}

/** Shown instead of the curve when there is nothing (yet) to draw. */
export function trainingFeedbackMissingHtml(reason) {
  const text = reason === 'incomplete' || reason === 'out_of_order'
    ? 'Complete the practice question above to see the uncertainty your answers imply.'
    : 'We could not draw a smooth curve for these answers. That is fine: your answers are recorded exactly as you gave them.';
  return `<section class="fit-card feedback-card"><p>${text}</p></section>`;
}

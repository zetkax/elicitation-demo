/**
 * Canvas rendering of the fitted Beta distribution, plus the card that frames
 * it. Takes a fit and plain options -- it never reads survey state, so the
 * worked example and a real response go through exactly the same code.
 */
import { betaQuantile, betaDensity, N } from "./stats.js";
import { formatPercent, niceTicks, formatDensity } from "./format.js";

/**
 * @param host       element to render into
 * @param fit        a valid fit from calculateBetaFit
 * @param opts.mode  "real" (default) | "practice" | "example"
 * @param opts.example  {prior, evidence, updated} -- required for "example"
 * @param opts.commentHtml  extra markup placed under the readout
 */
export function renderFitSummary(host, fit, opts = {}) {
  const { mode = "real", example: sample, commentHtml = "" } = opts;
  const lower = betaQuantile(0.05, fit.alpha, fit.beta);
  const upper = betaQuantile(0.95, fit.alpha, fit.beta);
  const lowerCount = Math.round(lower * N);
  const upperCount = Math.round(upper * N);
  const practice = mode === "practice";
  const example = mode === "example";

  // The real item asks whether the width feels right, because that answer is
  // the measurement. Practice and the worked example instead say what the
  // width means, so the respondent can read the output before it counts.
  let readout;
  if (example) {
    readout = `Someone who estimated ${sample.prior}, saw ${sample.evidence}, and
      revised to ${sample.updated} is telling us the rate is most likely around
      ${formatPercent(fit.mu, 0)}, with roughly a 90% chance it lies between
      ${lowerCount} and ${upperCount} out of 100. Had they revised further, the
      curve would be wider; had they barely moved, narrower.`;
  } else if (practice) {
    readout = `We read your two answers as: the success rate is most likely around
      ${formatPercent(fit.mu, 0)}, and there is roughly a 90% chance it lies
      between ${lowerCount} and ${upperCount} out of 100. A narrower band means
      you told us you were more certain; a wider one, less.`;
  } else {
    readout = `This implies roughly a 90% chance that the true success rate lies
      between ${lowerCount} and ${upperCount} attempts out of 100. Does that
      feel much too narrow, much too wide, or about right?`;
  }

  host.innerHTML = `
    <section class="fit-card" aria-labelledby="fit-title">
      <div class="fit-card__header">
        <span class="fit-eyebrow">${
          example ? "Worked example" : practice ? "Practice · what we read" : "Implied uncertainty"
        }</span>
        <h3 id="fit-title">Underlying probability of success</h3>
      </div>
      <div class="fit-metrics">
        <div class="fit-metric">
          <span>Mean</span>
          <strong>${formatPercent(fit.mu, 0)}</strong>
        </div>
      </div>
      <p class="fit-readout">${readout}</p>
      ${commentHtml}
      <div class="chart-wrap">
        <canvas class="beta-chart" data-beta-chart role="img"></canvas>
      </div>
      <div class="chart-legend" aria-hidden="true">
        <span><i class="legend-swatch legend-swatch--mean"></i>Mean</span>
        <span><i class="legend-swatch legend-swatch--interval"></i>Central 90% interval</span>
      </div>
      <p class="fit-note">${
        example
          ? "This is the Beta distribution implied by that pair of answers and nothing else."
          : "This is the Beta distribution implied by your initial estimate and how far you updated after the hypothetical evidence."
      }</p>
    </section>`;

  const canvas = host.querySelector("[data-beta-chart]");
  canvas.setAttribute(
    "aria-label",
    `Beta density with mean ${formatPercent(fit.mu)} and a roughly 90 percent chance the true success rate lies between ${lowerCount} and ${upperCount} attempts out of 100.`,
  );
  drawBetaChart(canvas, fit, lower, upper);
}

export function drawBetaChart(canvas, fit, lowerInterval, upperInterval) {
  const cssWidth = Math.max(300, canvas.clientWidth || 680);
  const cssHeight = Math.max(220, canvas.clientHeight || 290);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);

  const samples = 500;
  const points = [];

  for (let index = 0; index <= samples; index += 1) {
    const x = index / samples;
    points.push({ x, y: betaDensity(x, fit.alpha, fit.beta) });
  }

  const finiteDensities = points
    .map((point) => point.y)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const rawMax = finiteDensities[finiteDensities.length - 1] || 1;
  const robustIndex = Math.floor((finiteDensities.length - 1) * 0.985);
  const robustMax = finiteDensities[robustIndex] || rawMax;
  const yMax = Math.max(1e-9, Math.min(rawMax, robustMax * 3));

  // The axis stops at the tick above the data, which keeps the curve from
  // touching the top edge and makes the top gridline a real value.
  const axisFont = "12px Manrope, system-ui, sans-serif";
  const { ticks: yTicks, step: yStep } = niceTicks(yMax, 4);
  const yAxisMax = yTicks[yTicks.length - 1] || yMax;

  // When alpha or beta drops below 1 the density diverges at an edge, so the
  // plot is deliberately capped. Label the axis honestly in that case rather
  // than letting the top tick imply that is the true peak.
  const peakClipped = rawMax > yAxisMax * 1.001;

  context.font = axisFont;
  const yLabelWidth = yTicks.reduce(
    (widest, tick) =>
      Math.max(widest, context.measureText(formatDensity(tick, yStep)).width),
    0,
  );

  const plot = {
    left: Math.ceil(yLabelWidth) + 34,
    right: cssWidth - 18,
    top: 18,
    bottom: cssHeight - 38,
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;

  const mapX = (value) => plot.left + value * plotWidth;
  const mapY = (value) => plot.bottom - Math.min(value / yAxisMax, 1) * plotHeight;

  context.clearRect(0, 0, cssWidth, cssHeight);

  // Gridlines first, so the curve and interval band sit on top of them.
  context.strokeStyle = "#f1f1f3";
  context.lineWidth = 1;
  yTicks.forEach((tick) => {
    if (tick === 0) return;
    const y = Math.round(mapY(tick)) + 0.5;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
  });

  // The shaded band marks the central 90% credible interval.
  context.fillStyle = "rgba(38, 52, 135, 0.10)";
  context.fillRect(
    mapX(lowerInterval),
    plot.top,
    mapX(upperInterval) - mapX(lowerInterval),
    plotHeight,
  );

  context.strokeStyle = "#e6e6e9";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plot.left, plot.bottom + 0.5);
  context.lineTo(plot.right, plot.bottom + 0.5);
  context.stroke();

  context.setLineDash([4, 5]);
  context.strokeStyle = "rgba(38, 52, 135, 0.55)";
  [lowerInterval, upperInterval].forEach((value) => {
    context.beginPath();
    context.moveTo(mapX(value), plot.top);
    context.lineTo(mapX(value), plot.bottom);
    context.stroke();
  });
  context.setLineDash([]);

  const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
  gradient.addColorStop(0, "rgba(38, 52, 135, 0.20)");
  gradient.addColorStop(1, "rgba(38, 52, 135, 0.02)");

  context.beginPath();
  context.moveTo(mapX(points[0].x), plot.bottom);
  points.forEach((point) => context.lineTo(mapX(point.x), mapY(point.y)));
  context.lineTo(mapX(points[points.length - 1].x), plot.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    const method = index === 0 ? "moveTo" : "lineTo";
    context[method](mapX(point.x), mapY(point.y));
  });
  context.strokeStyle = "#263487";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.stroke();

  context.strokeStyle = "#1c1c1e";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(mapX(fit.mu), plot.top + 4);
  context.lineTo(mapX(fit.mu), plot.bottom);
  context.stroke();

  context.fillStyle = "#6b6b73";
  context.font = "12px Manrope, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    const x = mapX(tick);
    context.strokeStyle = "#e6e6e9";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, plot.bottom);
    context.lineTo(x, plot.bottom + 5);
    context.stroke();
    context.fillText(`${tick * 100}%`, x, plot.bottom + 10);
  });

  // Y axis: line, tick marks and density labels.
  context.strokeStyle = "#e6e6e9";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plot.left - 0.5, plot.top);
  context.lineTo(plot.left - 0.5, plot.bottom);
  context.stroke();

  context.fillStyle = "#6b6b73";
  context.font = axisFont;
  context.textAlign = "right";
  context.textBaseline = "middle";
  yTicks.forEach((tick) => {
    const y = mapY(tick);
    context.beginPath();
    context.moveTo(plot.left - 5, y);
    context.lineTo(plot.left - 0.5, y);
    context.stroke();
    context.fillText(formatDensity(tick, yStep), plot.left - 9, y);
  });

  context.save();
  context.translate(10, plot.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillStyle = "#8a8a92";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(peakClipped ? "Density (peak off scale)" : "Density", 0, 0);
  context.restore();
}

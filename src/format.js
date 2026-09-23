/**
 * Display formatting shared by the chart, the feedback text and the page copy,
 * so a count or a percentage is never rendered two different ways.
 */

export function formatCount(value) {
  return Number.isInteger(Number(value))
    ? String(Number(value))
    : Number(value).toFixed(1).replace(/\.0$/, "");
}

export function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

// Axis steps rounded to 1, 2 or 5 x 10^n so the density labels read cleanly.
export function niceTicks(max, targetCount) {
  const rough = max / Math.max(1, targetCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  // Thresholds sit between the 1/2/5 options rather than on them, so the
  // step chosen is the one landing nearest to targetCount ticks.
  const step =
    (normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10) *
    magnitude;

  // Run up to the first tick at or above max, so the caller can use the last
  // tick as the axis maximum and the curve never touches the top edge.
  const topTick = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let index = 0; index * step <= topTick + step * 1e-9; index += 1) {
    ticks.push(Number((index * step).toFixed(10)));
  }

  return { ticks, step };
}

export function formatDensity(value, step) {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
  return value.toFixed(decimals);
}

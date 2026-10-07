/**
 * CHIPS / ROULETTE
 * ----------------
 * The participant spreads a fixed number of chips over equal-width ranges of
 * the number of successful attempts out of 100 (the same quantity as the
 * Percentiles format); each chip is the same share of probability. The stored
 * value is simply the count in each bin, lowest bin first -- e.g. with 10 bins
 * and 20 chips, [0,0,1,4,8,5,2,0,0,0] -- so quantiles, interval widths or a
 * variance can be derived later without knowing anything about the interface.
 *
 * The helpers are pure; renderChips draws the widget into a host element and
 * reports every change through onChange (app.js stores it in the survey).
 */
import { CHIPS } from './design.js';

export const emptyChips = (bins = CHIPS.bins) => Array(bins).fill(0);

/** A stored value as a clean array of whole, non-negative counts. */
export function normaliseChips(value, bins = CHIPS.bins) {
  const out = emptyChips(bins);
  if (Array.isArray(value)) value.slice(0, bins).forEach((v, i) => { out[i] = Math.max(0, Math.floor(Number(v) || 0)); });
  return out;
}

export const chipsTotal = (value) => normaliseChips(value).reduce((a, b) => a + b, 0);

/**
 * Bin i covers whole numbers of successes out of 100 with no shared
 * endpoints: "0–9", "10–19", ... and the last bin includes 100: "90–100".
 */
export function binRange(i, bins = CHIPS.bins) {
  const width = 100 / bins;
  return [width * i, i === bins - 1 ? 100 : width * (i + 1) - 1];
}
export const binLabel = (i, bins = CHIPS.bins) => `${binRange(i, bins).join('–')} out of 100`;

/**
 * An error message if the allocation cannot be submitted, else null.
 * `allowEmpty` (answers optional) lets an untouched widget through, but never
 * a partial allocation: that is never a valid distribution.
 */
export function chipsError(value, { total = CHIPS.total, allowEmpty = false } = {}) {
  const used = chipsTotal(value);
  if (used === total || (allowEmpty && used === 0)) return null;
  return used < total
    ? `Place all ${total} chips before continuing: ${total - used} still to place.`
    : `Use exactly ${total} chips: remove ${used - total}.`;
}

export function renderChips(host, { value, onChange, bins = CHIPS.bins, total = CHIPS.total }) {
  let alloc = normaliseChips(value, bins);

  function draw() {
    const left = total - alloc.reduce((a, b) => a + b, 0);
    host.innerHTML = `<div class="chips">
      <p class="chips-status" tabindex="-1" aria-live="polite"><strong>${left}</strong> of ${total} chips left to place</p>
      <div class="chips-rows" role="group" aria-label="Chips per range of successful attempts out of 100">
        ${alloc.map((count, i) => `<div class="chips-row">
          <span class="chips-label">${binRange(i, bins).join('–')} <span class="chips-label-unit">out of 100</span></span>
          <button type="button" class="chips-btn" data-bin="${i}" data-step="-1" aria-label="Remove a chip from ${binLabel(i, bins)}"${count ? '' : ' disabled'}>−</button>
          <span class="chips-track" style="--slots:${total}" aria-hidden="true">${'<i class="chip"></i>'.repeat(count)}</span>
          <button type="button" class="chips-btn" data-bin="${i}" data-step="1" aria-label="Add a chip to ${binLabel(i, bins)}"${left ? '' : ' disabled'}>+</button>
          <span class="chips-count" aria-label="${count} chips in ${binLabel(i, bins)}">${count}</span>
        </div>`).join('')}
      </div>
      <button type="button" class="chips-clear" data-clear${left === total ? ' disabled' : ''}>Clear all</button>
    </div>`;
  }

  // One handler for the whole widget, assigned rather than added so a second
  // render into the same element replaces it. Redrawn after every change.
  host.onclick = (event) => {
    const button = event.target.closest?.('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-clear')) alloc = emptyChips(bins);
    else {
      const i = Number(button.dataset.bin);
      alloc[i] = Math.max(0, alloc[i] + Number(button.dataset.step));
    }
    draw();
    onChange([...alloc]);
    // Keep keyboard focus on the same control after the redraw.
    const same = button.hasAttribute('data-clear') ? null
      : host.querySelector(`button[data-bin="${button.dataset.bin}"][data-step="${button.dataset.step}"]`);
    (same && !same.disabled ? same : host.querySelector('.chips-status'))?.focus?.();
  };
  draw();
}

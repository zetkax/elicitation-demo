/**
 * Practice-round feedback. Takes plain numbers rather than reading survey
 * state, so the wording is unit-testable and cannot be reached by accident
 * from the real item -- where any feedback would shape what is being measured.
 */
import { formatCount, formatPercent } from "./format.js";

/** Reads back how far the respondent moved, and what that says about them. */
export function practiceCommentHtml(prior, evidence, updated) {
  const moved = Math.abs(updated - prior);
  const gap = Math.abs(evidence - prior);
  const share = gap > 0 ? moved / gap : 0;

  let note;
  if (share <= 0.2) {
    note = `You moved ${formatCount(moved)} of the ${formatCount(gap)} between your
            estimate and the result, so we read you as holding your original view
            firmly. That is a perfectly good answer if it is what you believe.`;
  } else if (share >= 0.8) {
    note = `You moved almost all the way to the hypothetical result, so we read you
            as having held your original number loosely. That is a perfectly good
            answer if it is what you believe.`;
  } else {
    note = `You moved about ${formatPercent(share, 0)} of the way from your estimate
            toward the result, so we read you as holding your original view with
            moderate confidence.`;
  }

  return `<p class="fit-readout">${note}</p>`;
}

/** Shown when a practice revision admits no Beta fit, i.e. fell outside the pair. */
export function practiceMissHtml(prior, evidence, updated) {
  const low = Math.min(prior, evidence);
  const high = Math.max(prior, evidence);
  const direction = evidence > prior ? "higher" : "lower";

  return `
    <section class="scenario-card" role="note">
      <span class="scenario-eyebrow">Practice · let's look at that again</span>
      <p>You estimated <strong>${formatCount(prior)}</strong> and then saw a hypothetical
      result of <strong>${formatCount(evidence)}</strong>. You answered
      <strong>${updated}</strong>.</p>
      <p>We could not read that as a revised belief. The result is ${direction} than
      your estimate, so seeing it should pull you somewhere <strong>between
      ${formatCount(low)} and ${formatCount(high)}</strong> &mdash; nearer your own
      number if you trust it, nearer the result if you do not.</p>
      <p>Answering exactly ${formatCount(prior)} would say the result told you nothing;
      answering exactly ${formatCount(evidence)} would say your own view counted for
      nothing. Both are strong claims, and neither is usually what people mean.</p>
      <p>Nothing here is marked. Use the back of your mind for it on the next one.</p>
    </section>`;
}

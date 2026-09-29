/** Shared field registry. First real update preserves the collector's original keys. */
export function makeItem(prefix, count = 1) {
  const key = base => prefix ? `${prefix}_${base}` : base;
  const updates = Array.from({ length: count }, (_, i) => ({
    evidence: key(`generated_x${i ? `_${i + 1}` : ''}`),
    answer: key(`updated_successes${i ? `_${i + 1}` : ''}`),
  }));
  return { prefix, isPractice: Boolean(prefix), prior: key('prior_successes'), updates,
    generatedX: updates[0].evidence, updated: updates[0].answer,
    fitValid: key('fit_valid'), fitNu: key('fit_nu'), fitAlpha: key('fit_alpha'), fitBeta: key('fit_beta'),
    interval: key('credible_interval_90'), interval50: key('credible_interval_50'),
    diagnostics: key('fit_diagnostics'), classification: key('update_classification'),
    outOfRange: key('updated_out_of_0_100'), invalidReason: key('fit_invalid_reason') };
}
export const MAIN_ITEM = makeItem('', 3);
export const PRACTICE_ITEMS = [makeItem('practice1'), makeItem('practice2', 3)];
export const ALL_ITEMS = [...PRACTICE_ITEMS, MAIN_ITEM];

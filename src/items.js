/**
 * ITEM REGISTRY
 * One elicitation item is three linked answers (prior, generated evidence,
 * updated estimate) plus the columns derived from them. The practice rounds
 * are the same item run twice more, so the machinery is keyed by prefix rather
 * than duplicated. The real item keeps its original unprefixed field names --
 * the collector sheet already has those columns, and renaming them would split
 * every existing response across two sets of headers.
 */

export function makeItem(prefix) {
  const key = (base) => (prefix ? `${prefix}_${base}` : base);
  return {
    prefix,
    isPractice: Boolean(prefix),
    prior: key("prior_successes"),
    generatedX: key("generated_x"),
    updated: key("updated_successes"),
    fitValid: key("fit_valid"),
    fitNu: key("fit_nu"),
    fitAlpha: key("fit_alpha"),
    fitBeta: key("fit_beta"),
    interval: key("credible_interval_90"),
    classification: key("update_classification"),
    outOfRange: key("updated_out_of_0_100"),
    invalidReason: key("fit_invalid_reason"),
  };
}

// The worked example on the training page. 47 is what the generator actually
// returns for an estimate of 40, so the example is the real mechanism rather
// than an illustration of it.
export const EXAMPLE = { prior: 40, evidence: 47, updated: 43 };

export const MAIN_ITEM = makeItem("");
export const PRACTICE_ITEMS = [makeItem("practice1"), makeItem("practice2")];
export const ALL_ITEMS = [...PRACTICE_ITEMS, MAIN_ITEM];
export const ITEM_BY_PREFIX = new Map(ALL_ITEMS.map((i) => [i.prefix, i]));

// Which item each page finishes, so leaving a page recomputes that item only.
export const PRIOR_PAGE_ITEM = {
  baseline: MAIN_ITEM,
  practice1_estimate: PRACTICE_ITEMS[0],
  practice2_estimate: PRACTICE_ITEMS[1],
};
export const UPDATE_PAGE_ITEM = {
  evidence: MAIN_ITEM,
  practice1_update: PRACTICE_ITEMS[0],
  practice2_update: PRACTICE_ITEMS[1],
};

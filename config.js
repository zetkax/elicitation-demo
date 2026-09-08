/**
 * Deployment settings for the elicitation prototype.
 *
 * `resultsEndpoint` is the Apps Script Web App URL (see apps-script/README.md).
 * Leaving it empty keeps the survey fully usable: responses are still logged to
 * the console and kept in localStorage, they are just not sent anywhere.
 *
 * `showExpectedRange` controls how the updated-estimate question is framed.
 * The field itself is never constrained either way -- respondents can always
 * submit anything numeric, and what they typed is recorded and classified.
 *
 *   true  - state the range a coherent update should fall in. An out-of-range
 *           answer then means someone disregarded an explicit instruction.
 *   false - state nothing. Tests whether coherent updating happens unprompted,
 *           at the cost of making a "wrong" answer harder to interpret.
 */
window.ELICITATION_CONFIG = {
  resultsEndpoint: "https://script.google.com/macros/s/AKfycbygoVxTpqbGnb3EPQFHn01Gt_6-Z3Iw4voaSn3qHgMm-e9ZJ3S9a7rQ3zWiNSP1cvawgQ/exec",
  surveyVersion: "2026-09-08-pilot",
  showExpectedRange: false,
};

/**
 * STANDALONE DIAGNOSTIC ITEMS
 * ---------------------------
 * Content only: edit the wording here. Where they appear is set in design.js
 * (DIAGNOSTIC_PLACEMENT); how they are built is pages/blocks.js. The
 * benchmarks are for analysis and are never shown to participants.
 *
 *   id         becomes the column prefix: diag_<id>_...
 *   html       the scenario, shown above the question
 *   question   the question text; for the low-probability item,
 *              {denominator} is replaced by the participant's assigned
 *              denominator (100 or 1,000) -- the only difference between
 *              its two conditions
 *   min / max  the accepted range (max defaults to the denominator)
 *   integer    true to accept whole numbers only (decimals otherwise)
 */
export const DIAGNOSTICS = {
  // Explicit Bayesian updating: prior 20/100 worth 100 observations, new
  // evidence 40/100, so the posterior mean is (20 + 40) / (100 + 100) = 30%.
  bayes: {
    id: 'bayes',
    html: `
      <p>A team has been estimating how often a warehouse robot correctly picks a requested item.
      Before any new testing, their best estimate was that it succeeds <strong>20 times out of
      100</strong>. That estimate carries as much information as if they had already watched
      <strong>100 previous attempts</strong>.</p>
      <p>They then run <strong>100 new attempts</strong> under the same conditions, and the robot
      succeeds in <strong>40</strong> of them.</p>`,
    question: 'Taking both the earlier estimate and the new attempts into account, what success rate (in %) would you now expect?',
    unit: '%',
    min: 0,
    max: 100,
    benchmark: 30,
  },

  // Chained steps: 0.9^5 = 0.59, so about 59 out of 100.
  chain: {
    id: 'chain',
    html: `
      <p>A software agent completes a task in <strong>5 steps</strong>, one after another. Each step
      succeeds <strong>90% of the time</strong>, independently of the others. If any step fails, the
      whole task fails.</p>`,
    question: 'Out of 100 tasks, how many would you expect the agent to complete successfully?',
    min: 0,
    max: 100,
    integer: true,
    benchmark: 59,
  },

  // Low-probability framing: the same real-world prevalence question, asked
  // out of 100 or out of 1,000. No hints about the true rate, and no feedback.
  lowprob: {
    id: 'lowprob',
    question: 'Imagine {denominator} adults in the UK were selected at random. About how many would you expect to have donated blood at least once in the past 12 months?',
    min: 0,
    // An answer of 0 only (pages/blocks.js zeroFollowUpPages).
    zeroQuestion: 'You answered 0. Which is closer to what you mean?',
    zeroChoices: {
      effectively_zero: 'I think the true rate could effectively be zero.',
      very_rare: 'I think some people do this, but the expected number is smaller than 1 in {denominator}.',
    },
    fineQuestion: 'Out of {fine} randomly selected adults in the UK, about how many would you expect to have donated blood at least once in the past 12 months?',
  },
};

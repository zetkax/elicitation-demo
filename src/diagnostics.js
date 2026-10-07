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
 *              denominator (100 or 1,000)
 *   min / max  the accepted range (max defaults to the denominator)
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
    benchmark: 59,
  },

  // Low-probability framing: identical event, asked out of 100 or out of 1,000.
  lowprob: {
    id: 'lowprob',
    html: `
      <p>A robot vacuum cleaner runs once a day in a two-storey house. The top of the staircase
      is not blocked off, and the robot relies on its own sensors to avoid the edge.</p>`,
    question: 'Out of {denominator} cleaning runs, in how many would you expect the robot to fall down the stairs?',
    min: 0,
    // Wording for the 0 / maximum follow-up (see pages/blocks.js).
    occurs: 'the robot falls down the stairs',
    doesNotOccur: 'the robot does not fall down the stairs',
    units: 'cleaning runs',
  },
};

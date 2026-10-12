/**
 * STANDALONE DIAGNOSTIC ITEMS
 * ---------------------------
 * Content only: edit the wording here. They come as one block after the main
 * questions and the consistency repeat, in a per-participant random order
 * (DIAGNOSTIC_IDS in design.js; assignment.js); how they are built is
 * pages/blocks.js. The benchmarks are for analysis and are never shown to
 * participants.
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
  // Explicit Bayesian updating: prior 25% worth 80 evaluations (20 successes),
  // new evidence 10/20, so the posterior mean is (20 + 10) / (80 + 20) = 30
  // out of 100.
  bayes: {
    id: 'bayes',
    html: `
      <p>A research team is evaluating how reliably an automated system completes a task.</p>
      <p>Based on previous information, they estimate that the system succeeds in <strong>25% of
      attempts</strong>. They consider this information to carry the same evidential weight as
      <strong>80 independent evaluations</strong>.</p>
      <p>The team then conducts <strong>20 new evaluations</strong> of the same system and observes
      <strong>10 successes</strong>.</p>
      <p>Assume that the system and conditions have not changed, and that all evaluations are
      independent.</p>`,
    question: 'Taking both the previous information and the new results into account, how many successes would you expect in the next 100 attempts?',
    min: 0,
    max: 100,
    benchmark: 30,
  },

  // Chained steps: 0.9^5 = 0.59, so about 59 out of 100.
  chain: {
    id: 'chain',
    html: `
      <p>An automated laboratory workflow consists of <strong>five consecutive steps</strong>. All five
      must succeed for the overall workflow to succeed.</p>
      <p>Each step has a <strong>90% chance</strong> of succeeding when attempted. Assume the steps
      succeed or fail independently of one another.</p>
      <p>If any step fails, the overall workflow fails. There is no opportunity to retry a failed
      step.</p>
      <p>Please answer without a calculator; we are interested in your quick estimate.</p>`,
    question: 'Out of 100 runs of the complete workflow, how many would you expect to succeed?',
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

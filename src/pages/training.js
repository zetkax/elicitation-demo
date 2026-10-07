import { card, countQuestion, percentileElements, chipsElements, updateSequence } from './methods.js';
import { PRACTICE } from '../items.js';
import { CHIPS } from '../design.js';

/**
 * TRAINING
 * --------
 * One practice of each response format, all on the same simple scenario, so
 * the only thing that changes is the format. Training answers are recorded
 * (prefix practice_) but are not expert judgments.
 *
 * Deliberately absent: any exercise that maps "how much you updated" onto
 * "how uncertain you are". How people update is one of the things the pilot
 * measures, so the training explains the Update format but does not teach a
 * right amount to move.
 */
const SCENARIO = `
  <p>Consider an AI agent controlling a robot. In each attempt, the robot must retrieve a specified mug from a
  cluttered kitchen counter, open the correct cupboard, place the mug on the designated shelf, and close the
  cupboard. The exact positions of the mug and surrounding objects vary between attempts. The robot and its
  sensors are functioning normally, and no human help is available.</p>
  <p>Success means the mug is placed on the correct shelf, nothing is dropped or damaged, and the cupboard is closed.</p>`;

const scenarioCard = (name) => ({ type: 'html', name, html: `<section class="scenario-card" aria-label="Practice scenario">
  <span class="scenario-eyebrow">Practice scenario</span>${SCENARIO}</section>` });

const { percentiles: P, chips: CHIPS_FIELD, update: U } = PRACTICE;

const steps = [
  { name: 'training_intro', label: 'Welcome', elements: [card('intro_text', `
    <p>We’re asking experts in [this area] what they expect a specified AI agent to be able to do, and how
    uncertain they are about those expectations. Thank you for taking part!</p>
    <p>You will express your uncertainty in three different ways, which we call <strong>Percentiles</strong>,
    <strong>Chips</strong> and <strong>Update</strong>. This short training lets you try each one on the same
    simple scenario. You do not need to do any statistical calculations; we’re interested in your own judgment.
    Training answers are for practice only and are not used as expert judgments.</p>`)] },

  { name: 'practice_percentiles', label: 'Percentiles', elements: [
    card('practice_percentiles_intro', `
      <p><strong>Percentiles.</strong> Give three values for the agent's true success rate:</p>
      <ul>
        <li><strong>10th percentile:</strong> you think there is a 10% chance the true value is lower.</li>
        <li><strong>50th percentile:</strong> you think it is equally likely to be above or below.</li>
        <li><strong>90th percentile:</strong> you think there is a 10% chance the true value is higher.</li>
      </ul>
      <p>The 10th and 90th percentiles are not "safe" outer limits. Across many questions, the true answer should
      fall <strong>outside</strong> your 10th–90th percentile range about <strong>2 times out of 10</strong>:
      once below it, once above it. Make the range as wide as your real uncertainty, and no wider.</p>`),
    scenarioCard('practice_percentiles_scenario'),
    ...percentileElements(P),
  ] },

  { name: 'practice_percentiles_feedback', label: 'Percentiles: your range', elements: [card('practice_percentiles_feedback_text', `
    <p>Your answers say there is an <strong>80% chance</strong> the true success rate is between
    <strong>{${P.p10}}%</strong> and <strong>{${P.p90}}%</strong>, and that it is as likely to be above
    <strong>{${P.p50}}%</strong> as below it.</p>
    <p>A useful check: if you imagine ten questions like this, would the true value land outside ranges like
    yours about twice? If it would almost never happen, your range is wider than your real uncertainty; if it
    would happen often, it is narrower.</p>`)] },

  { name: 'practice_chips', label: 'Chips', elements: [
    card('practice_chips_intro', `
      <p><strong>Chips.</strong> You have <strong>${CHIPS.total} chips</strong>. Each one stands for
      ${100 / CHIPS.total}% of your probability. Place them on the ranges of the success rate where you think the
      true value is, putting more chips where you think it is more likely. Use <strong>+</strong> and
      <strong>−</strong> to add or remove chips. All ${CHIPS.total} must be placed before you can continue.</p>`),
    scenarioCard('practice_chips_scenario'),
    ...chipsElements(CHIPS_FIELD),
  ] },

  { name: 'practice_update_intro', label: 'Update', elements: [card('practice_update_explanation', `
    <p><strong>Update.</strong> First you give your estimate of how many of 100 comparable attempts would succeed.
    Then you will see hypothetical evaluations of the same agent, hardware and task. Assume the results are
    accurate and representative, and the trials are independent.</p>
    <p>For each result, report what you would then expect for the next 100 comparable attempts. Each result
    is separate: start from your original view every time; the results do not accumulate.</p>
    <p>There is no single correct answer and <strong>no target amount you should move</strong>. Consider what you
    believed before together with the new evidence.</p>`)] },
];

const titled = (label, i, total) => `Training ${i} of ${total}\n${label}`;

// The Update practice: estimate, each hypothetical result, then the fit
// check -- the same pages as a main Update question.
function updatePractice(stepNo, total) {
  return updateSequence(U, {
    heading: (name) => titled(`Update: ${name.toLowerCase()}`, stepNo, total),
    estimatePage: { name: 'practice_estimate', title: titled('Update: initial estimate', stepNo, total), elements: [
      scenarioCard('practice_update_scenario'),
      countQuestion(U.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
    ] },
  });
}

const TOTAL = steps.length + 2;
export const trainingPages = [
  ...steps.map(({ name, label, elements }, i) => ({ name, title: titled(label, i + 1, TOTAL), elements })),
  ...updatePractice(steps.length + 1, TOTAL),
  { name: 'training_done', title: titled('Ready for the exercise', TOTAL, TOTAL), elements: [card('training_closing', `
    <p>You have practised all three formats. Next come the main questions, where we ask for your expert
    judgment. Each question uses one of the three formats.</p>
    <p>No model feedback will appear during the exercise, apart from the fitted distribution after an Update
    question.</p>`)] },
];

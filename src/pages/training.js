import { card, countQuestion, percentileElements, chipsElements, CHIPS_HEADING, CHIPS_PROMPT, updateSequence, feedbackElement } from './methods.js';
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
  <p><strong>Task</strong><br>
Given control of a household mobile robot, retrieve a specified rubber duck from a cluttered table, place it inside a designated storage box, and close the box.
</p>

<p><strong>Task-specific assumptions</strong><br>
The robot has a wheeled base, one articulated arm with a parallel-jaw gripper, and RGB-D cameras. It can navigate around the room, grasp small objects, and open or close the hinged lid of the box. The table, box, and robot start in fixed locations, but the duck and several harmless distractor objects are rearranged between attempts. All hardware and sensors function normally. No human assistance is available after the attempt begins.
</p>

<p><strong>Success</strong><br>
Success means that the robot:
</p>

<ul>
  <li>identifies and retrieves the correct duck;</li>
  <li>places it fully inside the designated box;</li>
  <li>closes the box;</li>
  <li>does not drop, damage, or incorrectly move any other object.</li>
</ul>`;

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
      <p><strong>Percentiles.</strong> Think about how many of <strong>100 comparable attempts</strong> would
      succeed. You are not sure of the true number, so give three numbers out of 100:</p>
      <ul>
        <li><strong>10th percentile:</strong> you think there is only a 10% chance the true number is lower.</li>
        <li><strong>50th percentile (your median):</strong> you think the true number is equally likely to be above or below it.</li>
        <li><strong>90th percentile:</strong> you think there is only a 10% chance the true number is higher.</li>
      </ul>
      <p>The 10th and 90th percentiles are not "safe" outer limits. Across many questions, the true answer should
      fall <strong>outside</strong> your 10th–90th percentile range about <strong>2 times out of 10</strong>:
      once below it, once above it.</p>`),
    scenarioCard('practice_percentiles_scenario'),
    ...percentileElements(P),
  ] },

  // Each practice format is followed by the same kind of picture: the smooth
  // curve its answers imply (drawn by app.js). Training only.
  { name: 'practice_percentiles_feedback', label: 'Percentiles: what your answers imply', elements: [
    card('practice_percentiles_feedback_recap', `<p>You gave <strong>{${P.p10}}</strong>, <strong>{${P.p50}}</strong>
      and <strong>{${P.p90}}</strong> successes out of 100 as your 10th, 50th and 90th percentiles.</p>`),
    feedbackElement('practice_percentiles_feedback_chart', 'practice_percentiles'),
    card('practice_percentiles_feedback_text', `
    <p>A useful check: across many questions like this, the true number should fall outside your 80% interval
    about <strong>2 times out of 10</strong>. If it would almost never happen, your range is wider than your real
    uncertainty; if it would happen often, it is narrower.</p>`),
  ] },

  { name: 'practice_chips', label: 'Chips', elements: [
    card('practice_chips_intro', `
      <p><strong>Chips. ${CHIPS_HEADING}</strong></p>
      <p>${CHIPS_PROMPT} Use <strong>+</strong> and <strong>−</strong> to add or remove chips; all ${CHIPS.total}
      must be placed before you can continue.</p>
      <p>For example, putting 4 chips in the 30–39 range means you think there is a 20% chance that the true
      number of successes out of 100 is between 30 and 39.</p>`),
    scenarioCard('practice_chips_scenario'),
    // The card above already gives the instruction, so the widget's own prompt is left out.
    ...chipsElements(CHIPS_FIELD, { prompt: false }),
  ] },

  { name: 'practice_chips_feedback', label: 'Chips: what your answers imply', elements: [
    feedbackElement('practice_chips_feedback_chart', 'practice_chips'),
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
// check -- the same pages as a main Update question, with the training's
// feedback card in place of the main survey's chart.
function updatePractice(stepNo, total) {
  return updateSequence(U, {
    heading: (name) => titled(`Update: ${name.toLowerCase()}`, stepNo, total),
    estimatePage: { name: 'practice_estimate', title: titled('Update: initial estimate', stepNo, total), elements: [
      scenarioCard('practice_update_scenario'),
      countQuestion(U.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
    ] },
    // The training feedback card explains itself, like the other two formats.
    fitIntro: null,
  });
}

const TOTAL = steps.length + 2;
export const trainingPages = [
  ...steps.map(({ name, label, elements }, i) => ({ name, title: titled(label, i + 1, TOTAL), elements })),
  ...updatePractice(steps.length + 1, TOTAL),
  { name: 'training_done', title: titled('Ready for the exercise', TOTAL, TOTAL), elements: [card('training_closing', `
    <p>You have practised all three formats. Next come the main questions, where we ask for your expert
    judgment. Each question uses one of the three formats.</p>`)] },
];

import { PRACTICE_ITEMS } from '../items.js';

export const card = (name, html) => ({ type: 'html', name, html: `<section class="scenario-card">${html}</section>` });
export function countQuestion(name, title, initial = false) {
  return { type: 'text', name, title, inputType: 'number', min: 0, max: 100,
    step: initial ? 1 : 'any', isRequired: true,
    description: initial ? 'Enter a whole number from 0 to 100.' : 'Enter a number from 0 to 100. Decimals are welcome.',
    validators: [{ type: 'numeric', minValue: 0, maxValue: 100 }],
    requiredErrorText: 'Enter your estimate before continuing.' };
}
export function updatePage(item, index, name, title) {
  const update = item.updates[index];
  return { name, title, elements: [
    { type: 'html', name: `${name}_context`, html: `<section class="evidence-card">
      <p><strong>Imagine this result only.</strong> Start from your original view; set aside any other hypothetical results.</p>
      <div class="evidence-grid"><div class="evidence-stat"><span>Your original estimate</span><strong>{${item.prior}} / 100</strong></div>
      <div class="evidence-stat"><span>Hypothetical successes</span><strong>{${update.evidence}} / 100</strong></div></div>
      <p class="evidence-caption">These 100 trials use the same agent, hardware, task and conditions. Results are accurate and representative; trials are independent.</p></section>` },
    countQuestion(update.answer, 'If you saw only this result, out of the next 100 comparable attempts, how many would succeed?'),
  ] };
}
/**
 * The joint fit of an item's three updates, then "too narrow / just right /
 * too wide". Used for practice 2 and for the real question, so the two stay
 * identical. Hidden when nothing can be fitted (an initial estimate of 0 or
 * 100), so those respondents are not stranded on an empty page.
 */
export function fitCheckPage(item, name, title) {
  return { name, title, visibleIf: `{${item.fitValid}} = true`, elements: [
    card(`${name}_intro`, `<p>This is the distribution fitted to your three answers together.</p>`),
    { type: 'html', name: `${name}_chart`, html: `<div data-fit-check="${item.prefix}"></div>` },
    { type: 'radiogroup', name: item.widthCheck, isRequired: true,
      title: 'How does the fitted distribution compare with your own uncertainty?',
      requiredErrorText: 'Choose one to continue.',
      choices: [
        { value: 'too_narrow', text: 'Too narrow' },
        { value: 'about_right', text: 'About right' },
        { value: 'too_wide', text: 'Too wide' },
      ] },
  ] };
}
const [first, second] = PRACTICE_ITEMS;
export const trainingPages = [
  { name: 'training_intro', title: 'Training 1 of 9\nWelcome', elements: [card('intro_text', `
    <p> We’re asking experts in [this area] what they expect a specified AI agent to be able to do, and how uncertain they are about those expectations. Thank you for taking part! </p><p>
The exercise takes about [K] minutes and begins with a short training. You do not need to perform any statistical calculations; we’re interested in your own judgment based on your knowledge of the domain. Training answers are for practice only and are not used as expert judgments.</p>
`)] },
  { name: 'practice1_estimate', title: 'Training 2 of 9\nFirst estimate', elements: [
    card('practice1_scenario', `<p><b>First, we’ll ask what you expect to happen across 100 comparable attempts.</b></p>
      <p>Consider an AI agent controlling a robot. In each attempt, the robot must retrieve a specified mug from a cluttered kitchen counter, open the correct cupboard, place the mug on the designated shelf, and close the cupboard. The exact positions of the mug and surrounding objects vary between attempts. The robot and its sensors are functioning normally, and no human help is available.
</p><p>Success means the mug is placed on the correct shelf, nothing is dropped or damaged, and the cupboard is closed.</p>`),
    countQuestion(first.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
  ] },
  { name: 'training_update', title: 'Training 3 of 9\nConsidering new evidence', elements: [card('update_explanation', `
    <p>Next, imagine an evaluation of 100 trials under <strong>the same conditions</strong>: the same AI agent, hardware and task. Assume the results are accurate and representative, and the trials are independent.</p>
    <p>Report how this evidence would actually change your view of the next 100 comparable attempts. There is no single correct answer.</p>
    <p>Consider what you believed before together with this new evidence, and report what you would now expect. <strong>There is no target amount you should move.</strong></p>`)] },
  updatePage(first, 0, 'practice1_update', 'Training 4 of 9\nTry an update'),
  { name: 'practice1_feedback', title: 'Training 5 of 9\nExplore your uncertainty',
    visibleIf: '{practice1_updated_successes} notempty', elements: [
      { type: 'html', name: 'practice1_fit', html: '<div class="fit-shell" data-practice-explorer></div>' },
  ] },
  { name: 'practice2_estimate', title: 'Training 6 of 9\nPractice the full format', elements: [
    card('practice2_scenario', `<p><strong>Now practise the full format without model feedback.</strong></p>

<p>Consider an AI agent controlling a robot that must plug a charging cable into a laptop.</p>

<ul>
  <li>The laptop and cable are on a table, but their exact positions and orientations vary between attempts.</li>
  <li>The correct cable is provided, the port is unobstructed, and the robot’s hardware and sensors are functioning normally.</li>
  <li>Success means the cable is fully inserted into the correct port and the laptop begins charging, without human help.</li>
</ul>

<p>You will consider three separate hypothetical evaluation results. Each starts from this original view; the results do not accumulate.</p>`),
    countQuestion(second.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
  ] },
  ...second.updates.map((_, i) => updatePage(second, i, `practice2_update${i ? `_${i + 1}` : ''}`, `Training 7 of 9\nIndependent update ${i + 1} of 3`)),
  // Hidden when no distribution can be fitted (an initial estimate of 0 or 100).
  fitCheckPage(second, 'practice2_fit_check', 'Training 8 of 9\nYour fitted distribution'),
  { name: 'training_done', title: 'Training 9 of 9\nReady for the exercise', elements: [card('training_closing', `
    <p>You have practised the full format. Next come the main questions, where we ask for your expert judgment.</p>
    <p>Give your initial estimate, then consider each of three hypothetical results separately. No model feedback will appear during the exercise.</p>`)] },
];

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
      <p class="evidence-caption">These 100 trials use the same agent, hardware, task and conditions. Results are accurate and representative; trials are independent. This is imagined evidence, not a hint about actual performance.</p></section>` },
    countQuestion(update.answer, 'If you saw only this result, out of the next 100 comparable attempts, how many would succeed?'),
  ] };
}
const [first, second] = PRACTICE_ITEMS;
export const trainingPages = [
  { name: 'training_intro', title: 'Training · 1 of 8 · Welcome', elements: [card('intro_text', `
    <p>This expert elicitation exercise asks what a specified AI agent can do and how uncertain you are about its success rate.</p>
    <p>No statistical formulas are needed. First, practise an estimate and a hypothetical update, explore what the model implies, then try the format on your own.</p>
    <p><strong>Training answers are practice only, not expert judgments.</strong> They are saved separately from your real responses. There is no score.</p>`)] },
  { name: 'practice1_estimate', title: 'Training · 2 of 8 · Your first estimate', elements: [
    card('practice1_scenario', `<p>Your central estimate is the number of successes you would expect across 100 comparable attempts, allowing for both successes and failures.</p>
      <p>For practice, consider an AI agent that copies appointment requests from emails into a calendar. Each request has one explicit date, time and title. The calendar is available; no clarification is needed. Success means all three details are entered correctly, without human help.</p>`),
    countQuestion(first.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
  ] },
  { name: 'training_update', title: 'Training · 3 of 8 · Considering new evidence', elements: [card('update_explanation', `
    <p>Next, imagine an evaluation of 100 trials under <strong>the same conditions</strong>: the same AI agent, hardware and task. Assume the results are accurate and representative, and the trials are independent.</p>
    <p>Report how this evidence would actually change your view of the next 100 comparable attempts. You do not need to calculate a textbook answer.</p>
    <p>Try to consider the new evidence fully rather than treating your first answer as something you need to defend. <strong>There is no target amount you should move.</strong></p>`)] },
  updatePage(first, 0, 'practice1_update', 'Training · 4 of 8 · Try an update'),
  { name: 'practice1_feedback', title: 'Training · 5 of 8 · Explore your uncertainty',
    visibleIf: '{practice1_updated_successes} notempty', elements: [
      { type: 'html', name: 'practice1_fit', html: '<div class="fit-shell" data-practice-explorer></div>' },
  ] },
  { name: 'practice2_estimate', title: 'Training · 6 of 8 · Try it independently', elements: [
    card('practice2_scenario', `<p>Now practise the full format without model feedback. Consider an AI agent using a browser to book a parcel collection.</p>
      <ul><li>It receives the address, parcel dimensions and a requested collection window.</li>
      <li>The website works, the window is available and payment is pre-authorized.</li>
      <li>Success means a confirmed collection with every detail correct, without human help.</li></ul>
      <p>You will consider three separate imagined evaluations. Each starts from this original view; they do not accumulate. This is practice, not a scored quiz.</p>`),
    countQuestion(second.prior, 'Out of 100 comparable attempts, how many would succeed?', true),
  ] },
  ...second.updates.map((_, i) => updatePage(second, i, `practice2_update${i ? `_${i + 1}` : ''}`, `Training · 7 of 8 · Independent update ${i + 1} of 3`)),
  { name: 'training_done', title: 'Training · 8 of 8 · Ready for the exercise', elements: [card('training_closing', `
    <p>You have practised the full format. Next comes your expert judgment about the restaurant agent.</p>
    <p>Give your initial estimate, then consider each of three hypothetical results separately. No model feedback will appear during the exercise.</p>`)] },
];

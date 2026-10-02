/**
 * THE MAIN-SURVEY QUESTIONS
 * -------------------------
 * The only file to edit to change what the six questions ask. Each one is run
 * in the same format as the last practice question: an initial estimate, three
 * hypothetical results, the fitted distribution, then the source of uncertainty.
 * They are shown in a random order per respondent.
 *
 *   id        becomes the prefix of every spreadsheet column for the question,
 *             e.g. "restaurant" -> restaurant_prior_successes. Lowercase letters,
 *             digits and underscores only. Set it once, BEFORE collecting real
 *             data, and never rename it afterwards: renaming moves the
 *             question's answers into new columns, splitting them from the old.
 *   scenario  the HTML shown above the initial-estimate question.
 *   uncertaintySources
 *             the answer options on that question's "Source of uncertainty"
 *             page. "Something else" (with a text box) is always added last.
 */

/**
 * SHARED CONTEXT
 * Conditions that hold for every question: shown in full on its own page
 * before the first question, then as a collapsed reminder at the top of every
 * question page. Defined once here so the two can never disagree.
 */
export const SHARED_CONTEXT = `
  <p><strong>[TODO: shared context for all questions]</strong></p>
  <p>For example: what "a state-of-the-art AI agent" means here, the point in
  time to imagine, which tools it has access to, and how much human help is
  available.</p>`;

// Used by any question that does not list sources of its own.
const GENERIC_SOURCES = [
  { value: 'model_capability', text: 'How capable current models are at this kind of task' },
  { value: 'agent_engineering', text: 'How well this particular agent is engineered (retries, error recovery, prompting)' },
  { value: 'no_evidence', text: 'I have not seen relevant benchmarks or deployment data to anchor on' },
  { value: 'task_variation', text: 'Variation between attempts in the conditions the agent faces' },
  { value: 'success_definition', text: 'What exactly counts as success' },
];

// Marks scenario text that still needs writing, so it is easy to search for.
const placeholder = (n) => `
  <section class="scenario-card" aria-label="Scenario conditions">
    <span class="scenario-eyebrow">Scenario</span>
    <p><strong>[TODO: scenario for question ${n}]</strong></p>
  </section>`;

export const QUESTIONS = [
  {
    id: 'restaurant',
    scenario: `
      <section class="scenario-card" aria-label="Scenario conditions">
        <span class="scenario-eyebrow">Scenario</span>
        <p>Consider a state-of-the-art AI agent that can use the internet and make phone calls. Its task is to call a restaurant and make a reservation for two people at 7 pm on a specified date.</p>
        <ul>
          <li>The correct restaurant phone number is provided.</li>
          <li>The restaurant has availability and accepts phone reservations.</li>
          <li>Success means the correct name, date, time, and party size are booked.</li>
        </ul>
      </section>`,
    uncertaintySources: [
      { value: 'model_capability', text: 'How capable current models are at multi-step tool use and real-time voice' },
      { value: 'agent_engineering', text: 'How well this particular agent is engineered — retries, error recovery, prompting' },
      { value: 'no_evidence', text: 'I have not seen relevant benchmarks or deployment data to anchor on' },
      { value: 'restaurant_variation', text: 'Variation between restaurants — staff, background noise, hold times, accents' },
      { value: 'success_definition', text: 'What counts as success — partial bookings, right table at the wrong time, no confirmation' },
    ],
  },
  { id: 'q2', scenario: placeholder(2) },
  { id: 'q3', scenario: placeholder(3) },
  { id: 'q4', scenario: placeholder(4) },
  { id: 'q5', scenario: placeholder(5) },
  
].map((q) => ({ ...q, uncertaintySources: q.uncertaintySources || GENERIC_SOURCES }));

// Ids end up as column names, so a bad or repeated one is caught at load time
// rather than discovered as scrambled data later.
const ids = QUESTIONS.map((q) => q.id);
for (const id of ids) {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`questions.js: invalid question id "${id}"`);
  if (/^practice\d/.test(id)) throw new Error(`questions.js: id "${id}" collides with the practice items`);
}
if (new Set(ids).size !== ids.length) throw new Error('questions.js: question ids must be unique');

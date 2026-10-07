/**
 * THE MAIN-SURVEY QUESTIONS
 * -------------------------
 * The only file to edit to change what the questions ask. Content only: each
 * participant answers every question in one of three response formats
 * (Percentiles, Chips or Update), set by their survey version in design.js,
 * in a random order (assignment.js). Q1..Q6 in design.js means the order of
 * this list.
 *
 *   id        becomes the prefix of every spreadsheet column for the question,
 *             e.g. "restaurant" -> restaurant_prior_successes. Lowercase letters,
 *             digits and underscores only. Set it once, BEFORE collecting real
 *             data, and never rename it afterwards: renaming moves the
 *             question's answers into new columns, splitting them from the old.
 *   scenario  the HTML shown above the question, whatever its format.
 *   uncertaintySources
 *             answer options for a "Source of uncertainty" question. Not asked
 *             at present; kept so the content is ready if it returns.
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

// The question format (Task / Task-specific assumptions / Success, with an
// optional failure carve-out) sits inside the same card on every question.
const scenario = (html) => `
  <section class="scenario-card" aria-label="Scenario conditions">
    <span class="scenario-eyebrow">Scenario</span>
    ${html}
  </section>`;

// DUMMY QUESTIONS for the pilot: three computational, three in the physical
// world. To be replaced -- give replacements new ids rather than reusing these.
export const QUESTIONS = [
  {
    id: 'django_migration',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      Migrate an open-source Python web application of about 40,000 lines from Django 3.2 to Django 5.0, so that it runs on the new version with its existing test suite passing.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent starts from a fresh clone of the repository on a Linux development machine. The project has about 1,200 tests, all passing on Django 3.2. The agent may change application code and dependencies, but may not delete, skip or weaken tests. The original developers are not available to answer questions.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>leaves the application starting and serving its pages on Django 5.0;</li>
        <li>has every original test passing, with none deleted, skipped or weakened;</li>
        <li>introduces no new deprecation warnings when the test suite runs;</li>
        <li>finishes within 24 hours of working time.</li>
      </ul>`),
  },
  {
    id: 'paper_replication',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      Reproduce the main regression table (six columns) of a published empirical economics paper from its public replication data, without access to the authors' analysis code.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent receives the paper as a PDF and the raw replication data: six files totalling about two million rows, with a codebook. The authors' code is withheld and they cannot be contacted. The agent has a computer with standard statistical software. The published results are known to be reproducible from these files.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>reports every coefficient in the table to within 5% of the published value;</li>
        <li>matches the published sample size in every column;</li>
        <li>delivers a single script that regenerates the full table from the raw files;</li>
        <li>finishes within 8 hours.</li>
      </ul>`),
  },
  {
    id: 'bird_classifier',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      Train an image classifier for a 200-class dataset of bird photographs that reaches at least 90% top-1 accuracy on a held-out test set, within a fixed compute budget.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent receives 60,000 labelled training images (about 300 per class) and an evaluation script. The 10,000 test images are held out and scored only on submission, at most five times. The agent has one machine with eight GPUs for 48 hours. Publicly available pretrained weights are allowed; additional bird images are not.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>submits a model scoring at least 90% top-1 accuracy on the held-out test set;</li>
        <li>stays within the 48-hour, eight-GPU budget;</li>
        <li>trains on no test images and no external bird data;</li>
        <li>delivers training code that reproduces the submitted score to within one percentage point.</li>
      </ul>`),
  },
  {
    id: 'plasmid_cloning',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      Using laboratory automation, clone a 1.5 kb gene fragment into a plasmid vector and obtain a sequence-verified construct, starting from supplied template DNA and reagents.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent controls a liquid-handling robot with an integrated thermocycler, incubator, colony picker and plate reader. Primers, enzymes, the vector, competent <i>E. coli</i>, plates and media are stocked and labelled. Sequencing goes to an external service and takes two days. No human touches the samples.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>runs the amplification, assembly and transformation steps;</li>
        <li>picks at least four colonies from the plates and prepares plasmid DNA from them;</li>
        <li>submits the prepared plasmids to the sequencing service;</li>
        <li>correctly identifies at least one sequence-verified clone within one week.</li>
      </ul>
      <p>Failures caused solely by defective supplied reagents or cells do not count against the agent.</p>`),
  },
  {
    id: 'pc_assembly',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      Assemble a desktop computer from boxed retail components and install a Linux operating system, so that the machine boots and detects all of its installed hardware.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent controls a two-armed robot with wrist cameras at a workbench. In retail packaging on the bench: motherboard, CPU, cooler with pre-applied thermal paste, two memory modules, SSD, graphics card, power supply, case, cables and screws. All parts are mutually compatible. A screwdriver, monitor, keyboard and USB installer are provided.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>installs every component in its correct slot or mount, with all required cables connected;</li>
        <li>damages no component, connector or pin;</li>
        <li>installs the operating system from the USB drive and boots into it;</li>
        <li>shows all memory, the SSD and the graphics card detected by the operating system;</li>
        <li>finishes within 4 hours.</li>
      </ul>`),
  },
  {
    id: 'table_clearing',
    scenario: scenario(`
      <p><strong>Task</strong><br>
      In a home the agent has not seen before, clear the dinner table after a meal for four people: load the dishwasher, store the leftovers and wipe the table.</p>
      <p><strong>Task-specific assumptions</strong><br>
      The agent controls a mobile robot with two arms and cameras. The table holds about 30 items: plates, glasses, cutlery, serving dishes with leftovers and paper napkins. The dishwasher starts empty, food containers are in a cupboard, and a cloth is by the sink. The layout and item positions are not known in advance.</p>
      <p><strong>Success</strong><br>
      Success means that the agent:</p>
      <ul>
        <li>loads every dishwasher-safe item without breaking anything;</li>
        <li>moves the leftovers into containers and puts them in the fridge;</li>
        <li>throws away napkins and food scraps;</li>
        <li>leaves the table wiped, with no visible crumbs or spills;</li>
        <li>finishes within 45 minutes.</li>
      </ul>`),
  },
].map((q) => ({ ...q, uncertaintySources: q.uncertaintySources || GENERIC_SOURCES }));

// Ids end up as column names, so a bad or repeated one is caught at load time
// rather than discovered as scrambled data later.
const ids = QUESTIONS.map((q) => q.id);
for (const id of ids) {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`questions.js: invalid question id "${id}"`);
  // These prefixes are taken by the training, the standalone items and the repeat.
  if (/^(practice|diag|consistency)/.test(id)) throw new Error(`questions.js: id "${id}" collides with a reserved prefix`);
  // "<id>_rare_..." holds each question's finer-scale answers (see items.js).
  if (/_rare$/.test(id)) throw new Error(`questions.js: id "${id}" may not end in _rare`);
}
if (new Set(ids).size !== ids.length) throw new Error('questions.js: question ids must be unique');

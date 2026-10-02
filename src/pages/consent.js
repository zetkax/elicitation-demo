import { card } from './training.js';

/**
 * The consent page, shown before anything else. Nothing is sent until the
 * respondent presses Finish, so someone who closes the page here leaves no
 * record at all -- the text below promises exactly that.
 *
 * The tick box is the one answer that stays required even when config.js sets
 * requireAnswers: false (see app.js): that switch is for clicking through the
 * pilot quickly, and must never let a response be saved without consent.
 *
 * DRAFT: every [TODO] needs filling in, and the wording checked against what
 * your institution requires, before anyone outside the team sees it.
 */
export const consentPage = {
  name: 'consent',
  title: 'Before you begin\nTaking part in this pilot',
  elements: [
    card('consent_text', `
      <p><strong>This is a pilot.</strong> We are trying out an exercise that asks experts what they
      expect AI agents to be able to do, and how uncertain they are. Your answers help us find what
      is unclear or missing before we run it more widely, so comments on the questions themselves
      are as useful to us as your estimates.</p>

      <p><strong>Who is running it.</strong> [TODO: organisation / research team], contact
      [TODO: name and email]. [TODO: ethics approval reference, or remove this sentence.]</p>

      <p><strong>What you will do.</strong> A short training section, then [TODO: number] questions
      about AI agents. It takes about [TODO: K] minutes. There are no right answers, and you can go
      back and change an answer at any point before you finish.</p>

      <p><strong>What we record.</strong></p>
      <ul>
        <li>Your answers, including any comments you write.</li>
        <li>The date you finished and how long the exercise took.</li>
        <li>TODO: are we gonna ask about demographics/baground/whatever?</li>
      </ul>
      <p>We do not record your name, email, IP address, browser, or the time of day you took
      part, so we cannot tell which response is yours. Please do not include anything that
      identifies you in your comments.</p>

      <p><strong>How it is stored and used.</strong> Responses are saved to a Google Sheet that only
      [TODO: who has access] can open. [TODO: how long it is kept, and whether pilot answers may be
      used in any published analysis.]</p>

      <p><strong>Taking part is voluntary.</strong> Nothing is saved until you press Finish on the
      last page, so if you close this page at any point before then, nothing is recorded.
      Because responses are anonymous, <strong>once you press Finish we cannot find or withdraw
      your response.</strong></p>`),
    {
      type: 'boolean',
      name: 'consent',
      renderAs: 'checkbox',
      titleLocation: 'hidden',
      label: 'I have read the information above and agree to take part in this pilot.',
      isRequired: true,
      // A required boolean counts "unticked" (false) as answered, so the tick
      // itself is what is checked.
      validators: [{ type: 'expression', expression: '{consent} = true', text: 'Tick the box to take part.' }],
      requiredErrorText: 'Tick the box to take part.',
    },
  ],
};

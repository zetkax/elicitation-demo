import { card } from './methods.js';
import { QUESTIONS } from '../questions.js';

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
  title: 'Before you begin',
  elements: [
    card('consent_text', `
      <p>
        This is a pilot study testing ways of asking experts about AI capabilities and uncertainty.
        It includes a short training section, ${QUESTIONS.length} main questions and several brief
        calibration questions, and should take about <strong>[XX] minutes</strong>.
      </p>

      <p>
        Participation is voluntary. We record your survey answers, optional comments,
        completion date and duration, and limited professional-background information (TODO: do we?).
        We do not store your name or email with your responses. A one-time invitation code
        is used to confirm eligibility and prevent duplicate submissions, and is kept
        separate from the response dataset.
      </p>

      <p>
        Pseudonymised responses may be accessed by authorised project researchers in the UK
        and US. US access is protected using the European Commission’s Standard Contractual
        Clauses. Raw responses will be retained for up to 2 years;
        anonymised or aggregate results may be retained and published longer.
      </p>

      <p>
        You may stop at any time before submitting. Because submitted responses are not linked
        to your identity, we may be unable to identify and remove your individual response afterwards.
      </p>

      <p>
        <strong>Data controller:</strong> [YOUR LEGAL/BUSINESS NAME],
        [CONTACT EMAIL].<br>
        <a href="[PRIVACY_NOTICE_URL]" target="_blank">Full privacy and data-use notice</a>
      </p>
    `),

    {
      type: 'boolean',
      name: 'consent',
      renderAs: 'checkbox',
      titleLocation: 'hidden',
      label: 'I have read the information above and agree to take part in this pilot.',
      isRequired: true,
      validators: [{
        type: 'expression',
        expression: '{consent} = true',
        text: 'Tick the box to take part.'
      }],
      requiredErrorText: 'Tick the box to take part.',
    },
  ],
};

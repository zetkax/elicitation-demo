# To do before the pilot

Open items for the elicitation pilot. Placeholders in the code are marked
`[TODO…]` or in square brackets; search for them to find each one.

## Before anyone outside the team sees the survey

- [ ] **Turn answers back on.** Set `requireAnswers: true` in `config.js` (or remove the line). While it is `false`, every question except consent can be skipped.
- [ ] **Finish the consent page** (`src/pages/consent.js`):
  - [ ] organisation / research team, contact name and email
  - [ ] ethics approval reference, or delete that sentence
  - [ ] how long the survey takes (`[TODO: K] minutes`)
  - [ ] who can open the results sheet
  - [ ] how long data is kept, and whether pilot answers may be used in published analysis
  - [ ] decide whether to ask demographic / background questions; if so, add them to the survey and to "What we record" (in a small expert pool they can identify people)
- [ ] **Check with your ethics contact / data protection officer.** Responses are anonymous (no name, browser, IP or time of day; date and duration only) and cannot be withdrawn after Finish. Confirm that this, and the consent wording, is acceptable.
- [ ] **Replace the remaining placeholder text:**
  - [ ] survey title `[insert domain]` (`src/app.js`)
  - [ ] `[this area]` on the training welcome page (`src/pages/training.js`)

## Survey content

- [ ] **Write the shared context** (`SHARED_CONTEXT` in `src/questions.js`): what "a state-of-the-art AI agent" means, the point in time, tools available, human help. Once written, move anything the physical-world questions repeat about the robot into it.
- [ ] **Replace the six dummy main questions** (`src/questions.js`). Give the real ones **new ids**: ids become spreadsheet column names. Q1–Q6 in the version table means the order of this list.
- [ ] **Review the standalone items' wording** (`src/diagnostics.js`). The Bayesian, chained-step and low-probability scenarios (robot vacuum on stairs) are placeholders; the maths and benchmarks (30, ≈59) are fixed.
- [ ] Decide whether to bring back the per-question "source of uncertainty" questions (removed; recoverable from commit `a808c67`).

## Design decisions to confirm

- [ ] **Update evidence rule** (`src/evidence.js`): results are now chosen by binomial tail probability so n=20 and n=100 are equally surprising, including the large "jump" result (previously a fixed 30–50-point move). Confirm the tail ranges. With n=20 and very extreme estimates (around 1–5% or 95–99%), counts are coarse: the "away from 50%" result can be 0 or 20, and two results can coincide.
- [ ] **Three hypothetical results per Update question**, plus the fitted distribution and "too narrow / about right / too wide" check. Confirm this, and that showing the fitted distribution in the main survey (the only model feedback participants see) is wanted.
- [ ] **0/100 follow-up on Percentiles** triggers only on the 50th percentile, not on a 10th percentile of 0 or a 90th of 100. Chips never triggers it.
- [ ] **Placement of the standalone items** (`DIAGNOSTIC_PLACEMENT` in `src/design.js`): currently after main questions 2, 4 and 6.
- [ ] **Update practice** uses evidence of n=100 (`PRACTICE_UPDATE_N` in `src/design.js`).

## Infrastructure and testing

- [ ] **Archive the old collector deployment** (old sheet → Extensions → Apps Script → Deploy → Manage deployments → ⋮ → Archive). Its URL is in the public repo's history.
- [ ] **Do a full test run on the live site** and check that a row lands in the new sheet. Try `?variant=A`, `?variant=B` and `?variant=C`, and a 0 / 100 answer. `docs/response-schema.md` lists every column.
- [ ] **Look over the pages on a phone**, especially the chips widget.
- [ ] Clear test rows out of the sheet before real data arrives (or filter on `survey_version` / `answers_required`).
- [ ] After the pilot, archive the current collector deployment too: the endpoint is unauthenticated and its URL is public.

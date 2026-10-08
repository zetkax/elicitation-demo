# Response schema

One row per participant in the `responses` sheet. Columns appear the first
time any response uses them, so a sheet holds the union of everything sent.
Arrays and objects arrive as JSON text (e.g. `[0,2,5,...]`). Columns for
things a participant was not asked are simply absent from their row.

`<id>` below is a main-question id from `src/questions.js`
(`django_migration`, `paper_replication`, `bird_classifier`,
`plasmid_cloning`, `pc_assembly`, `table_clearing`). Q1–Q6 in the design
means the order of that list, not the order a participant saw.

## Session and assignment

| Column | Meaning |
| --- | --- |
| `response_id` | Random id for this response |
| `submitted_date` | Date of submission (UTC, no time of day) |
| `duration_seconds` | Time from page load to Finish |
| `survey_version` | From `config.js` |
| `answers_required` | `false` if questions could be skipped (pilot testing) |
| `consent` | `true` |
| `survey_variant` | `A`, `B` or `C` |
| `variant_source` | `url` (from `?variant=`) or `random` |
| `question_order` | Question ids in presentation order |
| `main_plan` | `[{id, method, n, position}]` in presentation order; enough on its own to rebuild what was shown |
| `consistency_target` | Id of the first Percentiles question the participant saw |
| `diag_lowprob_denominator` | `100` or `1000` |
| `evidence_rule` | Name of the Update evidence rule (`src/evidence.js`) |
| `chart_style` | Style of the fitted-distribution chart (`line` or `dots`) |

## Every main question

| Column | Meaning |
| --- | --- |
| `<id>_method` | `percentiles`, `chips` or `update` |
| `<id>_position` | 1–6, presentation position |
| `<id>_format_rating` | 1 (very difficult) – 5 (very easy): "How easy was it to understand how you were supposed to express your uncertainty using this response format?" |
| `<id>_missing_info` | Optional free text: what would have helped |

### Fitted feedback and revision (every main question)

After the answer, every main question shows the smooth curve the answer
implies and asks: "Does this distribution roughly represent the uncertainty you
intended to express?" Anything but "about right" (or no curve at all) offers
**Edit my answer**, which returns to the question with the answer still filled
in; Continue keeps the answer. The rating comes after this loop, once.

The usual columns always hold the **final** answer and its fit. The first
answer is copied, once, the first time the feedback page is reached:

| Column | Meaning |
| --- | --- |
| `<id>_fit_feedback` | Final judgment: `about_right`, `too_narrow`, `too_wide`, `centre_wrong`, `other` (absent if no curve could be drawn) |
| `<id>_fit_feedback_other` | Final free text for `other` |
| `<id>_fit_feedback_first`, `<id>_fit_feedback_first_other` | The first judgment, on the original answer |
| `<id>_revision_count` | How many times the answer reached the feedback page changed (Edit or Back); 0 = never revised |
| `<id>_edit_requests` | Edit my answer clicks |
| `<id>_revision_history` | JSON list, one entry per visit to the feedback page: `{round, action, answer, fit: {p10, p50, p90, valid, rmse}, judgment, other}`; `action` is what they did next: `edit`, `continue` or `back` |
| `<id>_original_<field>` | The original answer: `original_p10/_p50/_p90` (Percentiles), `original_chips` (Chips), `original_prior_successes`, `original_generated_x…`, `original_updated_successes…`, `original_evidence_kinds` (Update), plus `original_boundary_…` when the 0/100 follow-up was used |
| `<id>_original_fit_<field>` | The fit of the original answer: `_p10/_p50/_p90`, `_valid`, `_alpha`, `_beta`, and `_rmse`/`_method` (Percentiles, Chips) or `_nu` (Update) |

For an Update question answered 0 or 100 the feedback page is skipped (no
curve can be fitted at the boundary); the fine-scale block keeps its own fit
check (`<id>_rare_width_check`). The main Update questions no longer have
`<id>_width_check`: `<id>_fit_feedback` replaces it.

### Percentiles

| Column | Meaning |
| --- | --- |
| `<id>_p10`, `<id>_p50`, `<id>_p90` | Successes out of 100 comparable attempts (0–100, decimals allowed); `p10 <= p50 <= p90` is enforced. Asked as counts, not as a percentage success rate. |

### Percentiles and Chips: smooth approximation

Beside the raw answers (which are never changed), each Percentiles and Chips
question also stores a Beta distribution fitted to them (`src/fitting.js`):
least squares on the cumulative distribution, at p10/p50/p90 for Percentiles,
and at the bin boundaries and midpoints for Chips. The same column names as an
Update question's fit, so every main question has `fit_p10/p50/p90`.

| Column | Meaning |
| --- | --- |
| `<id>_fit_valid` | Whether a fit was made (absent until all answers are in) |
| `<id>_fit_method` | `percentiles_cdf_least_squares_v1` or `chips_cdf_least_squares_v1` |
| `<id>_fit_alpha`, `<id>_fit_beta` | The fitted Beta (internal only; never shown to participants) |
| `<id>_fit_p10`, `<id>_fit_p50`, `<id>_fit_p90` | Its 10th, 50th and 90th percentiles, out of 100 |
| `<id>_fit_rmse` | Root-mean-square gap between the fitted and stated cumulative probabilities: how well a Beta matches the answers |
| `<id>_fit_invalid_reason` | Why no fit could be made, if so |

### Chips

| Column | Meaning |
| --- | --- |
| `<id>_chips` | Ten counts, lowest range first. Bin *i* is shown as successful attempts out of 100: 0–9, 10–19, …, 80–89, and 90–100 (the last includes 100). Read as a rate, bin *i* is [10*i*, 10*i*+10)%, as before. Always sums to 20; each chip is 5% probability. |

### Update

Estimates are out of 100 attempts; the hypothetical evidence is a count out of
`<id>_update_n` trials.

| Column | Meaning |
| --- | --- |
| `<id>_update_n` | `20` or `100` |
| `<id>_prior_successes` | Initial estimate (whole number, 0–100) |
| `<id>_generated_x`, `_2`, `_3` | Hypothetical successes shown, out of *n*, in display order |
| `<id>_evidence_kinds` | Kind of each result in display order: `extreme`, `middle`, `jump` |
| `<id>_evidence_tails` | Binomial tail probability of each result under the initial estimate (how surprising it was) |
| `<id>_updated_successes`, `_2`, `_3` | Updated estimate after each result, out of 100 |
| `<id>_fit_valid` | Whether a Beta could be fitted to the three updates |
| `<id>_fit_nu`, `<id>_fit_alpha`, `<id>_fit_beta` | The fitted Beta prior on the success rate |
| `<id>_fit_p10`, `<id>_fit_p50`, `<id>_fit_p90` | The fitted Beta's 10th, 50th and 90th percentiles, as successes out of 100: directly comparable with Percentiles' `p10`/`p50`/`p90`. The participant is shown the 80% interval `fit_p10`–`fit_p90`. |
| `<id>_credible_interval_90`, `<id>_credible_interval_50` | `[low, high]` of that Beta (5th–95th and 25th–75th percentiles), as rates (0–1) |
| `<id>_fit_diagnostics` | Fit details, including `n`, `scale`, residuals and per-result classifications |
| `<id>_update_classification` | How the first update relates to the estimate and evidence |
| `<id>_updated_out_of_0_100` | Any updated estimate outside 0–100 |
| `<id>_fit_invalid_reason` | Why no fit, e.g. `boundary_mean` after an estimate of 0 or 100 |
| `<id>_width_check` | Training and the fine-scale block only: `too_narrow`, `about_right` or `too_wide` (main questions use `<id>_fit_feedback`) |

## The 0 / maximum follow-up

Asked when an answer sits at either end of its scale: a Percentiles median
(`<id>_p50`), an Update initial estimate (`<id>_prior_successes`) and the
consistency repeat. The low-probability item has its own follow-up, for an
answer of 0 only (see Standalone items). **The original answer is
never changed**; these columns are added. `<prefix>` is `<id>`,
`consistency_repeat` or `diag_lowprob`.

| Column | Meaning |
| --- | --- |
| `<prefix>_boundary_meaning` | At 0: `impossible` or `very_rare`. At the maximum: `certain` or `not_certain` |
| `<prefix>_boundary_fine` | For `very_rare` / `not_certain`: a count out of 10,000 of the rare outcome |
| `<prefix>_boundary_fine_counts` | What that count counts: `successes` / `failures` (or `occurrences` / `non_occurrences` for the low-probability item) |

For an Update question, `very_rare` / `not_certain` also repeats the Update
format on the 10,000 scale, counting the rare outcome, in `<id>_rare_*`
columns (`_generated_x…`, `_updated…`, `_fit_…`, `_width_check`, …). Every
number in those columns is about the rare outcome: after an estimate of 100
they describe the **failure** rate. Its `_fit_p10/_p50/_p90` are out of 10,000.

## Standalone items

| Column | Meaning | Benchmark |
| --- | --- | --- |
| `diag_bayes_estimate` | Updated expected success rate in %: prior 20/100 worth 100 observations, new evidence 40/100 | 30 |
| `diag_chain_estimate` | Successes out of 100 for 5 steps at 90% each | ≈ 59 |
| `diag_lowprob_answer` | Raw answer, out of `diag_lowprob_denominator`: "Imagine 100 (or 1,000) adults in the UK were selected at random. About how many would you expect to have donated blood at least once in the past 12 months?" | — |
| `diag_lowprob_probability` | `answer / denominator` | — |
| `diag_lowprob_boundary_meaning` | Only after an answer of 0: `effectively_zero` ("could effectively be zero") or `very_rare` ("some people do this, but … smaller than 1 in 100 / 1,000") | — |
| `diag_lowprob_boundary_fine` | For `very_rare`: the count out of 10,000 (the original 0 stays in `diag_lowprob_answer`) | — |
| `diag_lowprob_boundary_fine_counts` | `occurrences` when the fine count was given | — |
| `consistency_repeat_estimate` | "Out of every 100 comparable attempts…" for `consistency_target`; compare with that question's `p50` | — |
| `consistency_target_p50` | The target question's final (accepted) 50th percentile: the primary comparison | — |
| `consistency_target_p50_original` | Its 50th percentile before any feedback or revision | — |
| `final_comments` | Optional free text | — |

## Comparing the three formats

All three give a 10th / 50th / 90th percentile of successes out of 100:
Percentiles directly (`p10`, `p50`, `p90`); Update from its fit
(`fit_p10`, `fit_p50`, `fit_p90`); Chips by interpolating the cumulative
chip counts over the bins (bin *i* spans 10*i* to 10*i*+10 when read as a
continuous count; each chip is 5%).

## Training

Same structure as the main formats, with the prefix `practice`:
`practice_p10/_p50/_p90`, `practice_chips`, and `practice_prior_successes`,
`practice_generated_x…`, `practice_updated_successes…`, `practice_fit_…`,
`practice_width_check` (practice evidence is out of 100). The smooth
approximations of the practice Percentiles and Chips answers, shown back to the
participant as training feedback, are in `practice_percentiles_fit_…` and
`practice_chips_fit_…` (same fields as above). Training answers are not expert
judgments.

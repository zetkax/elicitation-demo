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

### Percentiles

| Column | Meaning |
| --- | --- |
| `<id>_p10`, `<id>_p50`, `<id>_p90` | Successes out of 100 comparable attempts (0–100, decimals allowed); `p10 <= p50 <= p90` is enforced. Asked as counts, not as a percentage success rate. |

### Chips

| Column | Meaning |
| --- | --- |
| `<id>_chips` | Ten counts, lowest range first: bin *i* is [10*i*, 10*i*+10)% of success rate. Always sums to 20; each chip is 5% probability. |

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
| `<id>_credible_interval_90`, `<id>_credible_interval_50` | `[low, high]` of that Beta, as rates (0–1) |
| `<id>_fit_diagnostics` | Fit details, including `n`, `scale`, residuals and per-result classifications |
| `<id>_update_classification` | How the first update relates to the estimate and evidence |
| `<id>_updated_out_of_0_100` | Any updated estimate outside 0–100 |
| `<id>_fit_invalid_reason` | Why no fit, e.g. `boundary_mean` after an estimate of 0 or 100 |
| `<id>_width_check` | `too_narrow`, `about_right` or `too_wide` for the fitted distribution |

## The 0 / maximum follow-up

Asked when an answer sits at either end of its scale: a Percentiles median
(`<id>_p50`), an Update initial estimate (`<id>_prior_successes`), the
consistency repeat, and the low-probability item. **The original answer is
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
they describe the **failure** rate.

## Standalone items

| Column | Meaning | Benchmark |
| --- | --- | --- |
| `diag_bayes_estimate` | Updated expected success rate in %: prior 20/100 worth 100 observations, new evidence 40/100 | 30 |
| `diag_chain_estimate` | Successes out of 100 for 5 steps at 90% each | ≈ 59 |
| `diag_lowprob_answer` | Raw answer, out of `diag_lowprob_denominator` | — |
| `diag_lowprob_probability` | `answer / denominator` | — |
| `consistency_repeat_estimate` | "Out of every 100 comparable attempts…" for `consistency_target`; compare with that question's `p50` | — |
| `final_comments` | Optional free text | — |

## Training

Same structure as the main formats, with the prefix `practice`:
`practice_p10/_p50/_p90`, `practice_chips`, and `practice_prior_successes`,
`practice_generated_x…`, `practice_updated_successes…`, `practice_fit_…`,
`practice_width_check` (practice evidence is out of 100). Training answers are
not expert judgments.

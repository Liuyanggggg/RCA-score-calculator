# RCA rules, provenance and version conflicts

## Authoritative implementation basis

The website follows these latest local revisions:

1. `返修/revised_manuscript .docx` — modified 2026-10-30.
2. `返修/revised_Supporting_Information_S1_RCA_tool_effect_estimate.xlsx` — modified 2026-10-28.
3. `返修/revised_Supporting_Information_S2_RCA_tool_95CI.xlsx` — modified 2026-10-28.
4. `返修/revised_Supporting_Information_S3_v2_10NMAs.xlsx` — published example inputs and expected regression results.

The original files were not modified. No rule was inferred to fill a contradiction.

## Exact implemented rules

### Setup and eligibility

- 2–20 named, unique endpoints and at most 50 interventions.
- Comparator is required. Endpoint names and intervention names are compared case-insensitively for duplicates.
- `m` is an integer in `2..n`. Each intervention must have `k >= m` valid observed endpoints.
- A blocked intervention has no reported score set and no rank. Its coding cells and observed `k/M` remain visible for diagnosis.
- Negative and non-numeric weights are invalid even when the weighting switch is off, matching revised S1/S2 setup validation.

### Missing, zero and invalid cells

- Blank missing effects remain blank and are not coded as 0.
- Numeric zero is observed data. Whether it is favorable, neutral or unfavorable depends on the endpoint null and favorable direction.
- Point coding requires only a numeric effect. If effect is blank, it is missing even if interval limits are present.
- Interval coding requires all three cells to be blank (missing) or all three numeric. Partial cells produce `Incomplete CI`.
- Numeric intervals must satisfy `LCI <= effect <= UCI`; violations produce `Invalid CI` and block that intervention under interval coding.
- Non-finite values, hexadecimal strings and non-numeric text are not accepted as numbers. Ordinary decimal and scientific notation are accepted.

### Direction coding

For endpoint null `q`:

- Point estimate: +1 on the favorable side, −1 on the unfavorable side, and 0 when `effect = q`.
- Lower-is-favorable interval: +1 when `UCI < q`; −1 when `LCI > q`; otherwise 0.
- Higher-is-favorable interval: +1 when `LCI > q`; −1 when `UCI < q`; otherwise 0.

Thus an interval including **or touching** the null is 0. Strict inequalities are deliberate, including for rounded published limits.

### Scores

For observed directions `d_i` and effective weights `w_i`:

- `RCA_lite = Σ w_i d_i`.
- `RCA_cob = N(++) − N(−−)` where each pair count is weighted by `w_i w_j`.
- `RCA_scob = RCA_cob − N(+/−) − N(0/−)` with the same pair weights.

A pair with two favorable directions contributes `+w_iw_j` to COB. Two unfavorable directions contribute `−w_iw_j`. Opposite nonzero signs and zero/unfavorable pairs each subtract `w_iw_j` from SCOB as a penalty. Other pairs contribute zero.

Without weighting, every effective weight is 1. With weighting, a blank weight is 1. `W` and `T` are the endpoint-weight and pair-weight totals over all defined endpoints; `St` and `Tt` are the corresponding observed totals.

- `RCA_lite* = RCA_lite × W/St`.
- `RCA_cob* = RCA_cob × T/Tt`.
- `RCA_scob* = RCA_scob × T/Tt`.

Both observed denominators must be positive. Missing endpoints do not enter raw scores or observed denominators. Standardization does not restore missing evidence.

### Sorting and ties

Only eligible interventions are ranked. Keys are descending `cob*`, then `scob*`, then `lite*`. JavaScript double-precision values are compared exactly, as in the Excel formulas; no undocumented epsilon or name-based tie breaker is used.

Exact ties share a competition rank: `1 +` the number of lexicographically greater profiles. Source row order is used only for stable display. Consequently ranks can be `1, 1, 3` rather than `1, 1, 2`.

## Recorded conflicts

| ID | Earlier/source behavior | Latest behavior used by this website | Resolution and verification |
|---|---|---|---|
| C1 | `RCA_GitHub/README.md` says negative weights are treated as 0; older GitHub Excel formulas implement that behavior. | Latest manuscript and revised S1/S2 declare negative or non-numeric weights invalid. | Negative weights block scoring. This applies even with weighting off because revised setup formulas validate the weight cells independently. Unit tests cover both negative and non-numeric weights. |
| C2 | In S3, `Zhang 2025 NSCLC / Osimertinib + Bevacizumab` and `Jin 2020 HNSCC / CetuGEX + cisplatin + fluorouracil` each have `k=1`, but retain diagnostic raw scores and a standardized lite value; their ranks are blank. Pair standardization is undefined at `M=0`. | Latest manuscript and revised S1/S2 require `k >= m >= 2` and block scores and ranks below `m`. | Website displays `k < m` and no score set/rank. Regression tests independently verify the S3 diagnostic raw arithmetic but do not present those values as eligible website results. |
| C3 | `MedAdvances_R1/cdr9022.pdf`, Table 2, reports ICI monotherapy `RCA_scob = −3` for `(0, −1, −1, +1)` and describes unreported directions with 0 in its methods. | Latest manuscript gives `RCA_scob = −5` and explicitly distinguishes NA/missing from 0. | The pair arithmetic is `cob=−1`, two opposite-sign pairs and two zero/unfavorable pairs, hence `scob=−1−2−2=−5`. Website implements the latest definition and keeps missing endpoints out of the observed set. The worked-example regression checks this profile. |
| C4 | The source article classified ICI+Chemo ORR as favorable under interval coding. | Latest manuscript uses the published rounded interval `1.00 to 1.90`, which touches the null, and codes it 0; it documents that unrounded limits were unavailable. | Website uses strict exclusion and codes the rounded boundary 0. No unrounded value is invented. |

## Scope

Only null-based coding is implemented. Separate clinical benefit/harm thresholds described in the manuscript require a different prespecified procedure and are not silently approximated. RCA discards effect magnitude and interval width, does not model joint outcome uncertainty or correlation, and is not a validated patient-level benefit–risk utility.

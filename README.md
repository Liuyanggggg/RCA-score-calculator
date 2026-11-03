# RCA Score Calculator

Response-Consistency-Across-endpoints (RCA) scoring tools for network meta-analysis (NMA), including updated Excel workbooks and a complete browser-based calculator.

![Overview](overview.png)

## What is included

- **`RCA_tool_Effect.xlsx`** — point-estimate coding relative to the statistical null.
- **`RCA_tool_95CI.xlsx`** — 95% interval-exclusion coding; an interval including or touching the null is coded 0.
- **`Supporting_Information_S3_v2_10NMAs.xlsx`** — published application data, scores, ranks and sensitivity analyses used for regression verification.
- **`website/`** — complete source, locked dependencies, tests and production build of the local-first RCA website.

Each observed endpoint is coded as:

| Code | Meaning |
|------|---------|
| +1 | favorable |
| 0 | neutral or uncertain; missing endpoints are left blank and are not coded as 0 |
| −1 | unfavorable |

Three bounded scores summarize each intervention:

| Score | Definition |
|-------|------------|
| `RCA_lite` | directional net score: sum of directions |
| `RCA_cob` | concordance balance: favorable concordant pairs minus unfavorable concordant pairs |
| `RCA_scob` | strict concordance: `RCA_cob` minus pairs containing exactly one unfavorable direction |

Scores use observed endpoints and are standardized to the full endpoint scale. Ranking uses standardized `RCA_cob`, then standardized `RCA_scob`, then standardized `RCA_lite`, all descending. Exact ties share a rank.

## Browser calculator

The website supports manual entry, Excel import, both coding rules, side-by-side comparisons, per-intervention calculation audits, browser saves, complete JSON reload, and Excel/JSON export. It includes ten published example networks with 117 regimens. All computation is performed locally in the browser without accounts or a backend.

### Run from source

```bash
cd website
npm ci
npm run dev
```

### Serve the delivered production build

```bash
cd website
python3 -m http.server 8080 --directory dist
```

Open `http://127.0.0.1:8080`. The `website/dist/` directory can also be published directly on any static web host.

A GitHub Pages workflow is included at `.github/workflows/deploy.yml`. To use it, enable **GitHub Pages → Build and deployment → GitHub Actions** in the repository settings. The workflow builds and deploys `website/dist/` after pushes to `main`.

See [website/README.md](website/README.md) for full import formats, reproducibility, testing and deployment instructions.

## Excel quick start

No macros are required.

1. **`1-Setup`** — define the comparator, minimum observed endpoints `m` (default 2), up to 20 endpoints and up to 50 interventions.
2. **`2-Input_NMA_Data`** — enter the effect estimate and 95% interval for every available intervention–endpoint pair. Leave missing data blank.
3. **`3-Direction_Matrix`** — review the automatic +1/0/−1 coding.
4. **`4-RCA_Results`** — read `k_t`, `M_t`, raw and standardized scores, eligibility status and ranks.

Numeric zero is observed, not missing. Point estimates equal to the null are coded 0. Interval limits must satisfy `LCI <= effect <= UCI`; nonzero directions require strict exclusion of the null. Coverage below `m`, invalid inputs and non-positive observed weight denominators block scores and ranks.

## Optional weights

Set **Apply weights?** to **Yes** only when author-specified endpoint weights are intended. Blank weights equal 1. Weighted `RCA_lite` uses `w_i*d_i`; pairwise scores use `w_i*w_j`. Standardization uses total/observed weight denominators.

**Negative or non-numeric weights are invalid**, including when weighting is switched off, matching the latest revised manuscript and workbook validation. This supersedes the older repository description that treated negative weights as zero.

## Verification

The website calculation engine is independent of the interface. The test suite covers missing versus numeric zero, null-touching intervals, invalid and incomplete intervals, insufficient coverage, weights, standardization and exact ties.

Regression checks cover all 10 published networks, 117 regimens, 434 raw endpoint cells, both coding rules and 230 eligible published ranks. See [website/TEST_REPORT.md](website/TEST_REPORT.md) for the actual test report and [website/RULES_AND_CONFLICTS.md](website/RULES_AND_CONFLICTS.md) for source-rule provenance and documented version differences.

## Limitations

- RCA discards effect-size magnitude and interval width.
- Results depend on prespecified coding and coverage rules.
- Standardization cannot restore missing evidence.
- The calculators implement statistical-null coding, not separate clinical thresholds.
- RCA is a first-line screening tool, not a definitive benefit–risk assessment or patient-level treatment recommendation.

## Citation

> Liu Y, Song Y, Du Y, Qin C, Xu T. Response-consistency-across-endpoints (RCA) scores: a parsimonious screening summary for multi-outcome comparisons in network meta-analysis. *Medicine Advances* (in press, 2026).

If you use the tools, please also cite this repository and its release version.

## License

MIT — see [LICENSE](LICENSE).

# Actual test report

Test date: **2026-11-03 15:10–15:35 CST**
Project: RCA Score Calculator 1.0.0
Environment: macOS, Node.js 25.4.0, npm 11.7.0, Playwright Chromium 156.0.8078.4

## Final status

**PASS** — all delivered automated checks completed successfully on the production source and build.

| Check | Actual result |
|---|---|
| `npm test` | 3 test files passed; **32/32 tests passed** |
| `npm run test:e2e` | Fresh asset generation, TypeScript check and Vite production build passed; **6/6 browser workflows passed** |
| `npm audit` | **0 known vulnerabilities** |
| Production output | `dist/` generated successfully, approximately 456 KB including examples |
| Desktop browser inspection | Desktop 1440×900 and narrow 320/390 px views inspected; results navigation and layout usable |

## Unit, boundary and I/O tests

`tests/engine.test.ts`: **15 passed**

- Known profiles for all three scores, including `(0,−1,−1,+1) → (−1,−1,−5)`.
- Missing endpoint standardization and missing-versus-zero distinction.
- Numeric zero and effect exactly equal to a zero/nonzero null.
- Interval touching the lower or upper null boundary; strict favorable/unfavorable exclusion.
- Partial, non-numeric, reversed and effect-outside-interval cases.
- Point-rule missing versus interval-rule incomplete for the same raw cells.
- `k < m` blocking and exclusion from ranks.
- Negative/non-numeric weights, zero observed weight denominators, duplicate names, missing comparator and invalid `m`.
- Weighted lite, weighted pairs, standardization denominators and unfavorable penalties.
- Multi-key ordering and exact competition ties (`1,1,3`) with stable display order.

`tests/io.test.ts`: **6 passed**

- Complete JSON round-trip with identical canonical SHA-256 and exactly equal recomputed results.
- Real XLSX export containing all 11 expected worksheets.
- Excel export/import with exactly equal point and interval result objects.
- Deterministic workbook bytes and usable blank template.
- Original `1-Setup` + `2-Input_NMA_Data` workbook import.
- Rejection of unknown workbook layouts and malformed/unsupported JSON.

## Existing-data regression

`tests/reference.test.ts`: **11 passed**

- All 10 published networks in revised S3: **117 regimens**.
- Both coding rules: **234 rule-specific profiles**.
- **434 raw endpoint cells** checked against published point and interval directions.
- Raw lite/cob/scob recomputed from every published direction profile.
- Standardized lite/cob/scob checked for every eligible published profile.
- **230 published eligible ranks** checked exactly.
- Main-manuscript worked example: all 9 regimens, both coding rules, all 18 direction profiles and ranks reproduced.

The two `k=1` S3 rows are handled explicitly: their diagnostic raw arithmetic is checked, while the website correctly blocks their full score sets and ranks under the latest `m>=2` rules. They are not counted as agreement with eligible score output. See conflict C2 in `RULES_AND_CONFLICTS.md`.

## Production browser workflows

`tests/e2e/workflow.spec.ts`: **6 passed**

1. Load the published example, calculate real point and interval results, compare both rules, open a regimen audit, and verify six pair rows; no browser console errors.
2. Create a blank analysis, enter effects and intervals manually, calculate both rules, change an upper limit to exactly the null, and verify the coding comparison and audit explanation.
3. Save a named analysis in browser storage, modify it, reload the saved version, verify restoration, and delete the saved record.
4. Download real JSON and Excel files; verify the 64-character input digest and workbook contents; reload both files and verify the analysis identity and recalculation.
5. Import an exported workbook, verify results, switch to a 390×844 viewport, and confirm core controls remain visible with no document-level horizontal overflow.
6. Import an original RCA-layout workbook in the browser and calculate both rules, including an interval touching the null while retaining `k=2, M=1`.

The E2E command runs against `vite preview` and a newly generated `dist/`, not only a development server.

## Manual browser inspection

The production build was opened at `http://127.0.0.1:4173` in the desktop browser and inspected manually.

- Desktop setup and results pages were visually inspected at 1440×900.
- The results page displayed the expected rank-1 profile and four exact rank-2 ties in the Yanagisawa example.
- A 320 px narrow viewport was inspected; form controls wrapped and navigation remained horizontally scrollable.
- Automated 390 px layout verification also passed.

## Build and dependency evidence

- `npm run generate:assets`: passed; blank template, example JSON and example results Excel regenerated.
- `tsc -b`: passed with strict TypeScript checks covering source and tests.
- `vite build`: passed; 77 modules transformed.
- Main JavaScript: 409.68 KB (119.60 KB gzip); CSS: 14.57 KB (3.90 KB gzip).
- `dist/examples/` contains all three delivered example/template files.
- `npm audit`: 0 vulnerabilities after replacing libraries with known unresolved advisories.

## Not tested / deployment boundary

- No remote deployment was attempted because no hosting repository/account credentials were supplied. Local production build and static-server delivery were fully verified.
- Safari and Firefox were not automated; Chromium desktop and narrow viewport behavior were tested. The implementation uses standard modern browser APIs.
- Native Microsoft Excel rendering was not available as an automated application test. XLSX files were independently ZIP/XML parsed, round-tripped, and checked for complete worksheets and values.
- The original paper files were read as evidence and were not modified.

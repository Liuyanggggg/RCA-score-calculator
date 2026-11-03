# RCA Score Calculator — local research website

A complete, browser-local implementation of **Response-Consistency-Across-endpoints (RCA)** scoring for network meta-analysis. The interface is in English; all calculations run on the user's device with no account, backend, tracking, or data upload.

## Delivered functionality

- Manual setup of 2–20 endpoints and up to 50 interventions, with comparator, minimum coverage `m`, favorable direction, null value, optional statistic, and optional weights.
- Manual effect/LCI/UCI entry and real `.xlsx` import.
- Point-estimate and 95% interval-exclusion coding, calculated independently.
- Raw and standardized `RCA_lite`, `RCA_cob`, and `RCA_scob`; `k`, `M`, eligibility, exact-tie ranks, and side-by-side coding/rank comparison.
- Per-intervention audit: coding reason for every endpoint, every endpoint-pair contribution, weight denominators, standardization factors, and ranking rule.
- Ten published example networks from revised Supporting Information S3 (117 regimens total), selectable in the Data tab.
- Named browser saves with load/delete; complete JSON save/reload; results-and-audit Excel export; blank Excel template.
- Reproducibility metadata and SHA-256 digest of the canonical complete input.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ (validated with Node.js 25.4.0 and npm 11.7.0).

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`.

### Production build

```bash
npm ci
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. The production files are already delivered in `dist/`; rebuilding is optional.

To serve the delivered build with Python instead:

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://127.0.0.1:8080`. Do not double-click `dist/index.html` using `file://`: browser module and ZIP/JSON loading rules require an HTTP server. Use HTTPS for public deployment; the SHA-256 function uses the browser Web Crypto API.

## Deploy as a static website

No backend environment variables are needed. Deploy the **contents** of `dist/`, not the project root.

- **GitHub Pages:** run `npm ci && npm run build` in the deployment workflow and publish `dist/` as the Pages artifact. Vite uses relative asset paths (`base: './'`), so project subpaths work. If publishing from a branch, copy `dist/` to the branch root. A repository and permission to push/configure Pages are required only for the actual remote publication.
- **Netlify:** build command `npm run build`; publish directory `dist`. Alternatively drag the delivered `dist/` folder into Netlify Drop.
- **Vercel:** framework preset Vite; build command `npm run build`; output directory `dist`.
- **Institutional web server / Nginx:** copy `dist/*` to the desired document root. No rewrite rules are needed because this is a single-page document without client-side routes. Enable HTTPS.

Browser saves use `localStorage` and are scoped to the exact origin (scheme, host, and port). Export JSON before moving to another origin or clearing browser data.

## Excel import formats

Only `.xlsx` is supported, not legacy `.xls`. Imports are limited to 15 MB and must match a declared layout; ambiguous columns are rejected rather than guessed.

### Original RCA workbook

The importer reads only raw setup and input cells from:

- `1-Setup`: comparator, `m`, weighting switch, endpoint definitions, and intervention names.
- `2-Input_NMA_Data`: effect, LCI, and UCI triplets.

Existing direction/result formulas are not trusted or evaluated. Both coding rules are recalculated from the imported raw inputs. Formula cells without a cached value are treated as blank, so save the source workbook in Excel before importing if necessary.

### Website template or exported workbook

Required sheets and columns:

- `Metadata`: analysis name, comparator, minimum `m`, weighting switch, versions, and digest.
- `Endpoints`: `ID`, `Name`, `Favorable direction`, `Null value`, `Weight`, `Statistic`.
- `Interventions`: `ID`, `Name`.
- `Effects`: `Intervention ID`, `Endpoint ID`, `Effect`, `LCI`, `UCI`.

Unknown IDs and duplicate intervention/endpoint effect rows are errors. An omitted effect row is treated as missing. Use **Data → Download template** or the delivered `public/examples/RCA-input-template.xlsx`.

## Reproducible exports

### JSON

Contains the complete raw input strings, endpoint/intervention order, all parameters, application/engine/schema versions, canonicalization rule, and SHA-256 digest. Object keys are recursively sorted before hashing; array order is preserved. Reloading the JSON recomputes both rule sets rather than restoring potentially stale results.

### Excel

Contains 11 worksheets: metadata, endpoints, interventions, raw effects, point results, interval results, both direction matrices, coding audit, pair audit, and rules/versions. Numeric results are exported at JavaScript double precision; display rounding in the interface does not alter calculations. The same input produces deterministic workbook bytes because archive timestamps are fixed.

Ready-to-share examples are delivered in both `public/examples/` and `dist/examples/`:

- `RCA-input-template.xlsx`
- `Yanagisawa-2024-mRCC.rca.json`
- `Yanagisawa-2024-mRCC-results.xlsx`

## Calculation source and conflicts

The implementation follows the latest revised manuscript and revised S1/S2 Excel tools, not the older GitHub behavior. Exact formulas and all identified source conflicts are documented in [RULES_AND_CONFLICTS.md](RULES_AND_CONFLICTS.md).

Separate clinical thresholds are intentionally **not** implemented. The supplied tools use statistical-null coding only. RCA is a screening aid, not a definitive benefit–risk ranking.

## Tests

```bash
npm test                 # 32 unit, boundary, reference and I/O tests
npx playwright install chromium
npm run test:e2e         # fresh production build + 6 browser workflows
npm audit                # dependency vulnerability audit
```

The actual results are recorded in [TEST_REPORT.md](TEST_REPORT.md).

The S3 regression covers 10 networks, 117 regimens, 434 endpoint-direction checks per rule comparison, 234 rule-specific profiles, and 230 published eligible ranks. The two source rows with `k=1` are checked separately because the latest rules block all their scores/ranks while S3 retains diagnostic raw values.

## Source layout

```text
src/engine/            UI-independent validation, coding, scoring and ranking
src/io/                XLSX ZIP/XML, workbook mapping, JSON, downloads, local storage
src/data/              Extracted published inputs and expected reference results
src/App.tsx            React interface
src/styles.css         Responsive visual design
scripts/               Reproducible reference extraction and example generation
 tests/                 Unit/reference/I/O tests and Playwright workflows
dist/                  Production deployment artifact
```

`package-lock.json` locks the complete dependency tree. Runtime dependencies are React, React DOM, `fflate`, and `fast-xml-parser`; there is no Excel application or server dependency.

Validated direct versions include React 19.3.1, Vite 7.3.7, TypeScript 5.9.3, Vitest 4.1.12, Playwright 1.64.1, `fflate` 0.8.3, and `fast-xml-parser` 5.11.2.

## License

MIT; see [LICENSE](LICENSE).

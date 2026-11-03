import { mkdir, writeFile } from 'node:fs/promises';
import { analysisDigest, createPublishedAnalysis } from '../src/engine/analysis.ts';
import { analysisWorkbook, exportAnalysisJson, templateWorkbook } from '../src/io/workbook.ts';

const directory = new URL('../public/examples/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('RCA-input-template.xlsx', directory), templateWorkbook());
const example = createPublishedAnalysis();
const digest = await analysisDigest(example);
await writeFile(new URL('Yanagisawa-2024-mRCC.rca.json', directory), exportAnalysisJson(example, digest));
await writeFile(new URL('Yanagisawa-2024-mRCC-results.xlsx', directory), analysisWorkbook(example, digest));
console.log('Generated the blank template and reproducible published-example files.');

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from '../src/io/xlsx.ts';

const localSource = new URL('../../返修/revised_Supporting_Information_S3_v2_10NMAs.xlsx', import.meta.url);
const repositorySource = new URL('../../Supporting_Information_S3_v2_10NMAs.xlsx', import.meta.url);
let source = repositorySource;
try {
  await readFile(fileURLToPath(localSource));
  source = localSource;
} catch {
  source = repositorySource;
}
const workbook = readWorkbook(await readFile(fileURLToPath(source)));
const excluded = new Set(['Summary', 'Inversions', 'Sensitivity', 'Rank_comparisons', 'Liu 2026 worked example']);
const text = (value) => value == null ? '' : String(value).trim();
const direction = (value) => {
  const string = text(value);
  if (!string || string === 'NA' || string === '-') return null;
  const number = Number(string);
  if (![-1, 0, 1].includes(number)) throw new Error(`Invalid reference direction: ${string}`);
  return number;
};
const optionalNumber = (value) => {
  const string = text(value);
  return !string || string === '-' || string === 'NA' ? null : Number(string);
};
const effect = (value) => {
  const string = text(value);
  if (!string) return { effect: '', lci: '', uci: '' };
  const match = string.match(/^\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[\[,(]\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[;,]\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[\])]/);
  if (!match) throw new Error(`Cannot parse effect: ${string}`);
  return { effect: match[1], lci: match[2], uci: match[3] };
};
const endpointMeta = (header) => {
  const name = header.replace(/\s*\(?(?:HR|OR|RR)\)?\s*\(?95%\s*C[Ii]\)?\s*$/i, '').replace(/\s+/g, ' ').trim();
  const higher = /^ORR\b/i.test(header);
  return { name, statistic: /\bHR\b/i.test(header) ? 'HR' : /\bRR\b/i.test(header) ? 'RR' : 'OR', favorable: higher ? 'Higher' : 'Lower', nullValue: '1', weight: '' };
};

const networks = [];
for (const sheet of workbook.filter((item) => !excluded.has(item.name))) {
  const headers = (sheet.rows[0] ?? []).map(text);
  const endpoints = [];
  for (let column = 3; column <= 15 && headers[column]; column += 3) {
    if (headers[column + 1] !== 'dir pt' || headers[column + 2] !== 'dir CI') break;
    endpoints.push({ ...endpointMeta(headers[column]), column });
  }
  if (endpoints.length < 2) throw new Error(`No endpoints parsed in ${sheet.name}`);
  const col = (prefix) => headers.findIndex((header) => header?.startsWith(prefix));
  const columns = {
    litePt: col('RCA_lite (pt)'), cobPt: col('RCA_cob (pt)'), scobPt: col('RCA_scob (pt)'),
    liteStdPt: col('lite* (pt)'), cobStdPt: col('cob* (pt)'), scobStdPt: col('scob* (pt)'), rankPt: col('Order (pt)'),
    liteStdCi: col('lite* (CI)'), cobStdCi: col('cob* (CI)'), scobStdCi: col('scob* (CI)'), rankCi: col('Order (CI)'),
  };
  const interventions = [];
  for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    const name = text(row[0]);
    if (!name) continue;
    interventions.push({
      name,
      values: endpoints.map((endpoint) => effect(row[endpoint.column])),
      expected: {
        k: optionalNumber(row[1]),
        point: {
          directions: endpoints.map((endpoint) => direction(row[endpoint.column + 1])),
          lite: optionalNumber(row[columns.litePt]), cob: optionalNumber(row[columns.cobPt]), scob: optionalNumber(row[columns.scobPt]),
          liteStd: optionalNumber(row[columns.liteStdPt]), cobStd: optionalNumber(row[columns.cobStdPt]), scobStd: optionalNumber(row[columns.scobStdPt]), rank: optionalNumber(row[columns.rankPt]),
        },
        interval: {
          directions: endpoints.map((endpoint) => direction(row[endpoint.column + 2])),
          liteStd: optionalNumber(row[columns.liteStdCi]), cobStd: optionalNumber(row[columns.cobStdCi]), scobStd: optionalNumber(row[columns.scobStdCi]), rank: optionalNumber(row[columns.rankCi]),
        },
      },
    });
  }
  networks.push({
    id: sheet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: sheet.name,
    comparator: 'Common reference comparator (see source NMA)',
    minimumEndpoints: 2,
    applyWeights: false,
    endpoints: endpoints.map(({ column, ...endpoint }) => endpoint),
    interventions,
  });
}

const workedSheet = workbook.find((sheet) => sheet.name === 'Liu 2026 worked example');
if (!workedSheet) throw new Error('Worked-example worksheet not found.');
const worked = [];
for (const row of workedSheet.rows.slice(1)) {
  if (!row[0]) continue;
  worked.push({
    name: text(row[0]), rule: text(row[1]), directions: [2, 3, 4, 5].map((column) => direction(row[column])),
    k: optionalNumber(row[6]), pairs: optionalNumber(row[7]),
    lite: optionalNumber(row[8]), cob: optionalNumber(row[9]), scob: optionalNumber(row[10]),
    liteStd: optionalNumber(row[11]), cobStd: optionalNumber(row[12]), scobStd: optionalNumber(row[13]), rank: optionalNumber(row[14]),
  });
}

await writeFile(new URL('../src/data/publishedExamples.json', import.meta.url), `${JSON.stringify({ source: '返修/revised_Supporting_Information_S3_v2_10NMAs.xlsx', networks }, null, 2)}\n`);
await writeFile(new URL('../tests/fixtures/workedExampleDirections.json', import.meta.url), `${JSON.stringify(worked, null, 2)}\n`);
console.log(`Extracted ${networks.length} networks and ${networks.reduce((sum, network) => sum + network.interventions.length, 0)} regimens; ${worked.length / 2} worked-example regimens under both rules.`);

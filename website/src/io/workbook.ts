import { createBlankAnalysis, normalizeAnalysis } from '../engine/analysis.ts';
import { calculateAnalysis } from '../engine/engine.ts';
import { APP_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from '../engine/types.ts';
import type { Analysis, CodingRule, InterventionResult, RuleResult, WorkbookSheet } from '../engine/types.ts';
import { readWorkbook, writeWorkbook } from './xlsx.ts';

const cell = (rows: Array<Array<string | number | null>>, row: number, column: number): string => String(rows[row]?.[column] ?? '').trim();

function sheet(workbook: WorkbookSheet[], name: string): WorkbookSheet {
  const found = workbook.find((item) => item.name === name);
  if (!found) throw new Error(`Required worksheet not found: ${name}`);
  return found;
}

function headerMap(rows: Array<Array<string | number | null>>, expected: string[]): Map<string, number> {
  const headers = (rows[0] ?? []).map((value) => String(value ?? '').trim());
  const map = new Map<string, number>();
  for (const name of expected) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Required column not found: ${name}`);
    map.set(name, index);
  }
  return map;
}

function importWebWorkbook(workbook: WorkbookSheet[]): Analysis {
  const metadataRows = sheet(workbook, 'Metadata').rows;
  const metadata = new Map<string, string>();
  for (let row = 1; row < metadataRows.length; row += 1) {
    const key = cell(metadataRows, row, 0);
    if (key) metadata.set(key, cell(metadataRows, row, 1));
  }
  const endpointRows = sheet(workbook, 'Endpoints').rows;
  const endpointColumns = headerMap(endpointRows, ['ID', 'Name', 'Favorable direction', 'Null value', 'Weight', 'Statistic']);
  const endpoints = [];
  for (let row = 1; row < endpointRows.length; row += 1) {
    if (!cell(endpointRows, row, 0) && !cell(endpointRows, row, 1)) continue;
    endpoints.push({
      id: cell(endpointRows, row, endpointColumns.get('ID') as number) || `E${endpoints.length + 1}`,
      name: cell(endpointRows, row, endpointColumns.get('Name') as number),
      favorable: cell(endpointRows, row, endpointColumns.get('Favorable direction') as number) as 'Lower' | 'Higher',
      nullValue: cell(endpointRows, row, endpointColumns.get('Null value') as number),
      weight: cell(endpointRows, row, endpointColumns.get('Weight') as number),
      statistic: cell(endpointRows, row, endpointColumns.get('Statistic') as number),
    });
  }
  const interventionRows = sheet(workbook, 'Interventions').rows;
  const interventionColumns = headerMap(interventionRows, ['ID', 'Name']);
  const interventions = [];
  for (let row = 1; row < interventionRows.length; row += 1) {
    if (!cell(interventionRows, row, 0) && !cell(interventionRows, row, 1)) continue;
    interventions.push({
      id: cell(interventionRows, row, interventionColumns.get('ID') as number) || `T${interventions.length + 1}`,
      name: cell(interventionRows, row, interventionColumns.get('Name') as number),
      values: endpoints.map(() => ({ effect: '', lci: '', uci: '' })),
    });
  }
  const effectRows = sheet(workbook, 'Effects').rows;
  const effectColumns = headerMap(effectRows, ['Intervention ID', 'Endpoint ID', 'Effect', 'LCI', 'UCI']);
  const seen = new Set<string>();
  for (let row = 1; row < effectRows.length; row += 1) {
    const interventionId = cell(effectRows, row, effectColumns.get('Intervention ID') as number);
    const endpointId = cell(effectRows, row, effectColumns.get('Endpoint ID') as number);
    if (!interventionId && !endpointId) continue;
    const interventionIndex = interventions.findIndex((item) => item.id === interventionId);
    const endpointIndex = endpoints.findIndex((item) => item.id === endpointId);
    if (interventionIndex < 0 || endpointIndex < 0) throw new Error(`Effects row ${row + 1} references an unknown intervention or endpoint ID.`);
    const key = `${interventionId}\u0000${endpointId}`;
    if (seen.has(key)) throw new Error(`Duplicate effect row for ${interventionId} / ${endpointId}.`);
    seen.add(key);
    interventions[interventionIndex].values[endpointIndex] = {
      effect: cell(effectRows, row, effectColumns.get('Effect') as number),
      lci: cell(effectRows, row, effectColumns.get('LCI') as number),
      uci: cell(effectRows, row, effectColumns.get('UCI') as number),
    };
  }
  return normalizeAnalysis({
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    engineVersion: ENGINE_VERSION,
    name: metadata.get('Analysis name') || 'Imported RCA analysis',
    comparator: metadata.get('Comparator') || '',
    minimumEndpoints: Number(metadata.get('Minimum endpoints m') || 2),
    applyWeights: (metadata.get('Apply weights') || 'No') === 'Yes',
    endpoints,
    interventions,
  });
}

function importNativeWorkbook(workbook: WorkbookSheet[]): Analysis {
  const setup = sheet(workbook, '1-Setup').rows;
  const input = sheet(workbook, '2-Input_NMA_Data').rows;
  const endpoints = [];
  for (let row = 6; row < 26; row += 1) {
    const name = cell(setup, row, 1);
    if (!name) continue;
    endpoints.push({
      id: `E${endpoints.length + 1}`, name,
      favorable: cell(setup, row, 2) as 'Lower' | 'Higher',
      nullValue: cell(setup, row, 3), weight: cell(setup, row, 4), statistic: cell(setup, row, 5),
    });
  }
  const interventions = [];
  for (let row = 28; row < 78; row += 1) {
    const name = cell(setup, row, 1);
    if (!name) continue;
    const inputRow = row - 26;
    interventions.push({
      id: `T${interventions.length + 1}`, name,
      values: endpoints.map((_, endpointIndex) => ({
        effect: cell(input, inputRow, 1 + endpointIndex * 3),
        lci: cell(input, inputRow, 2 + endpointIndex * 3),
        uci: cell(input, inputRow, 3 + endpointIndex * 3),
      })),
    });
  }
  return normalizeAnalysis({
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    engineVersion: ENGINE_VERSION,
    name: 'Imported RCA Excel analysis',
    comparator: cell(setup, 1, 1),
    minimumEndpoints: Number(cell(setup, 3, 1) || 2),
    applyWeights: cell(setup, 3, 3) === 'Yes',
    endpoints,
    interventions,
  });
}

export function importWorkbook(data: ArrayBuffer | Uint8Array): Analysis {
  const workbook = readWorkbook(data);
  if (workbook.some((item) => item.name === 'Metadata') && workbook.some((item) => item.name === 'Effects')) return importWebWorkbook(workbook);
  if (workbook.some((item) => item.name === '1-Setup') && workbook.some((item) => item.name === '2-Input_NMA_Data')) return importNativeWorkbook(workbook);
  throw new Error('Unrecognized workbook. Use the website template/export or an original RCA workbook with 1-Setup and 2-Input_NMA_Data.');
}

function resultRows(rule: RuleResult): Array<Array<string | number | null>> {
  return [
    ['Intervention ID', 'Intervention', 'k', 'Observed pairs M', 'RCA_lite', 'RCA_cob', 'RCA_scob', 'RCA_lite*', 'RCA_cob*', 'RCA_scob*', 'Rank', 'Status', 'Status reason', 'Observed weight St', 'Observed pair weight Tt', 'Lite factor', 'Pair factor'],
    ...rule.results.map((result) => [
      result.id, result.name, result.k, result.pairs,
      result.scores?.lite ?? '', result.scores?.cob ?? '', result.scores?.scob ?? '',
      result.scores?.liteStd ?? '', result.scores?.cobStd ?? '', result.scores?.scobStd ?? '',
      result.rank ?? '', result.status, result.statusReason, result.observedWeight, result.observedPairWeight, result.liteFactor ?? '', result.pairFactor ?? '',
    ]),
  ];
}

function directionRows(analysis: Analysis, results: InterventionResult[]): Array<Array<string | number | null>> {
  return [
    ['Intervention ID', 'Intervention', ...analysis.endpoints.map((endpoint) => endpoint.name)],
    ...results.map((result) => [result.id, result.name, ...result.cells.map((cell) => cell.direction ?? '')]),
  ];
}

export function analysisWorkbook(analysis: Analysis, canonicalSha256 = ''): Uint8Array {
  const normalized = normalizeAnalysis(analysis);
  const calculated = calculateAnalysis(normalized);
  const metadata: WorkbookSheet = {
    name: 'Metadata',
    rows: [
      ['Field', 'Value'],
      ['Schema version', SCHEMA_VERSION], ['Application version', APP_VERSION], ['Engine version', ENGINE_VERSION],
      ['Excel implementation', 'Deterministic OOXML ZIP/XML 1.0'], ['Canonical input SHA-256', canonicalSha256],
      ['Analysis name', normalized.name], ['Comparator', normalized.comparator], ['Minimum endpoints m', normalized.minimumEndpoints],
      ['Apply weights', normalized.applyWeights ? 'Yes' : 'No'], ['Endpoint count n', normalized.endpoints.length],
      ['Missing data', 'Blank; excluded from observed set and never converted to 0'],
      ['Ranking', 'RCA_cob* descending, then RCA_scob*, then RCA_lite*; exact ties share a competition rank'],
    ],
  };
  const endpoints: WorkbookSheet = {
    name: 'Endpoints',
    rows: [['ID', 'Name', 'Favorable direction', 'Null value', 'Weight', 'Statistic'], ...normalized.endpoints.map((endpoint) => [endpoint.id, endpoint.name, endpoint.favorable, endpoint.nullValue, endpoint.weight, endpoint.statistic])],
  };
  const interventions: WorkbookSheet = {
    name: 'Interventions',
    rows: [['ID', 'Name'], ...normalized.interventions.map((intervention) => [intervention.id, intervention.name])],
  };
  const effects: WorkbookSheet = {
    name: 'Effects',
    rows: [['Intervention ID', 'Intervention', 'Endpoint ID', 'Endpoint', 'Effect', 'LCI', 'UCI']],
  };
  for (const intervention of normalized.interventions) for (const [index, endpoint] of normalized.endpoints.entries()) {
    const input = intervention.values[index];
    effects.rows.push([intervention.id, intervention.name, endpoint.id, endpoint.name, input.effect, input.lci, input.uci]);
  }
  const pairAudit: WorkbookSheet = { name: 'Pair audit', rows: [['Rule', 'Intervention ID', 'Intervention', 'Left endpoint', 'Right endpoint', 'Left direction', 'Right direction', 'Category', 'Pair weight', 'COB contribution', 'Unfavorable penalty', 'SCOB contribution']] };
  const codingAudit: WorkbookSheet = { name: 'Coding audit', rows: [['Rule', 'Intervention ID', 'Intervention', 'Endpoint ID', 'Endpoint', 'Effect', 'LCI', 'UCI', 'Direction', 'Status', 'Reason']] };
  for (const rule of [calculated.point, calculated.interval]) {
    for (const result of rule.results) {
      const intervention = normalized.interventions[result.sourceIndex];
      result.cells.forEach((cell, index) => {
        const endpoint = normalized.endpoints[index];
        const input = intervention.values[index];
        codingAudit.rows.push([rule.rule, result.id, result.name, endpoint.id, endpoint.name, input.effect, input.lci, input.uci, cell.direction ?? '', cell.status, cell.reason]);
      });
      for (const pair of result.pairContributions) pairAudit.rows.push([rule.rule, result.id, result.name, pair.leftName, pair.rightName, pair.leftDirection, pair.rightDirection, pair.category, pair.weight, pair.cob, pair.penalty, pair.scob]);
    }
  }
  const rules: WorkbookSheet = {
    name: 'Rules and versions',
    rows: [
      ['Topic', 'Specification'],
      ['Point coding', 'Effect relative to null: favorable side +1, null 0, unfavorable side -1. Numeric zero is observed.'],
      ['Interval coding', 'Requires LCI <= effect <= UCI. Favorable/unfavorable codes require strict exclusion. Including or touching null gives 0.'],
      ['RCA_lite', 'Sum of w_i*d_i over observed endpoints.'],
      ['RCA_cob', 'Sum of w_i*w_j for ++ pairs minus that for -- pairs.'],
      ['RCA_scob', 'RCA_cob minus w_i*w_j for +/- and 0/- pairs.'],
      ['Standardization', 'lite* = lite*W/St; cob* and scob* multiply by T/Tt. Positive observed St and Tt are required.'],
      ['Coverage', 'k >= m >= 2 is required; ineligible rows have no scores or rank.'],
      ['Weights', 'Blank = 1 when weighting is enabled. Negative and non-numeric weights are invalid even when weighting is disabled.'],
      ['Version conflict', 'Older GitHub README/tools treated negative weights as zero. This implementation follows the latest revised manuscript and revised S1/S2: negative weights are invalid.'],
      ['Clinical thresholds', 'Not implemented. Only the stated statistical null is used.'],
      ['Source', '返修/revised_manuscript .docx; revised Supporting Information S1/S2 (October 2026).'],
    ],
  };
  return writeWorkbook([
    metadata, endpoints, interventions, effects,
    { name: 'Point results', rows: resultRows(calculated.point) }, { name: 'Interval results', rows: resultRows(calculated.interval) },
    { name: 'Point directions', rows: directionRows(normalized, calculated.point.results) },
    { name: 'Interval directions', rows: directionRows(normalized, calculated.interval.results) },
    codingAudit, pairAudit, rules,
  ]);
}

export function templateWorkbook(): Uint8Array {
  const blank = createBlankAnalysis();
  blank.name = 'RCA analysis template';
  blank.interventions = [
    { id: 'T1', name: 'Intervention A', values: blank.endpoints.map(() => ({ effect: '', lci: '', uci: '' })) },
    { id: 'T2', name: 'Intervention B', values: blank.endpoints.map(() => ({ effect: '', lci: '', uci: '' })) },
  ];
  return analysisWorkbook(blank);
}

export function exportAnalysisJson(analysis: Analysis, canonicalSha256: string): string {
  return `${JSON.stringify({
    ...normalizeAnalysis(analysis),
    reproducibility: {
      canonicalSha256,
      canonicalization: 'UTF-8 JSON with recursively sorted object keys; array order preserved',
      software: { application: APP_VERSION, engine: ENGINE_VERSION, schema: SCHEMA_VERSION, excel: 'OOXML ZIP/XML 1.0' },
      calculation: 'calculateAnalysis; point and interval rules computed independently from raw input strings',
    },
  }, null, 2)}\n`;
}

export function parseAnalysisJson(text: string): Analysis {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Analysis JSON must contain an object.');
  return normalizeAnalysis(value as Analysis);
}

export function codingLabel(rule: CodingRule): string {
  return rule === 'point' ? 'Point-estimate coding' : '95% interval-exclusion coding';
}

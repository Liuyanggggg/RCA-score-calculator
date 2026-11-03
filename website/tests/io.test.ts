import { describe, expect, it } from 'vitest';
import { analysisDigest, createPublishedAnalysis } from '../src/engine/analysis.ts';
import { calculateAnalysis } from '../src/engine/engine.ts';
import { analysisWorkbook, exportAnalysisJson, importWorkbook, parseAnalysisJson, templateWorkbook } from '../src/io/workbook.ts';
import { readWorkbook, writeWorkbook } from '../src/io/xlsx.ts';
import { APP_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from '../src/engine/types.ts';

describe('reproducibility and Excel I/O', () => {
  it('round-trips complete JSON without changing input digest or results', async () => {
    const analysis = createPublishedAnalysis();
    const digest = await analysisDigest(analysis);
    const restored = parseAnalysisJson(exportAnalysisJson(analysis, digest));
    expect(restored).toEqual(analysis);
    expect(await analysisDigest(restored)).toBe(digest);
    expect(calculateAnalysis(restored)).toEqual(calculateAnalysis(analysis));
    expect(JSON.parse(exportAnalysisJson(analysis, digest)).reproducibility.software).toEqual({ application: APP_VERSION, engine: ENGINE_VERSION, schema: SCHEMA_VERSION, excel: 'OOXML ZIP/XML 1.0' });
  });

  it('exports a real workbook with all input, result and audit sheets', () => {
    const analysis = createPublishedAnalysis();
    const bytes = analysisWorkbook(analysis, 'abc123');
    const workbook = readWorkbook(bytes);
    expect(workbook.map((sheet) => sheet.name)).toEqual(['Metadata', 'Endpoints', 'Interventions', 'Effects', 'Point results', 'Interval results', 'Point directions', 'Interval directions', 'Coding audit', 'Pair audit', 'Rules and versions']);
    expect(workbook.find((sheet) => sheet.name === 'Effects')?.rows.length).toBe(1 + analysis.interventions.length * analysis.endpoints.length);
    expect(workbook.find((sheet) => sheet.name === 'Pair audit')?.rows.length).toBe(61);
    expect(workbook.find((sheet) => sheet.name === 'Metadata')?.rows[5]).toEqual(['Canonical input SHA-256', 'abc123']);
  });

  it('reimports the exported workbook and reproduces both result sets exactly', () => {
    const analysis = createPublishedAnalysis('kim-2026-hcc');
    const restored = importWorkbook(analysisWorkbook(analysis));
    expect(restored).toEqual(analysis);
    expect(calculateAnalysis(restored)).toEqual(calculateAnalysis(analysis));
  });

  it('creates a usable template and produces deterministic workbook bytes', () => {
    const first = templateWorkbook();
    const second = templateWorkbook();
    expect(first).toEqual(second);
    const analysis = importWorkbook(first);
    expect(analysis.endpoints).toHaveLength(2);
    expect(analysis.interventions).toHaveLength(2);
  });

  it('imports the original RCA 1-Setup and 2-Input_NMA_Data layout', () => {
    const workbook = writeWorkbook([
      { name: '1-Setup', rows: [
        ['Setup'], ['Comparator:', 'Chemotherapy'], ['n', 4], ['m', 2, 'Apply weights?', 'Yes'], [], ['ID', 'Name', 'Direction', 'Null', 'Weight', 'Statistic'],
        ['E1', 'OS', 'Lower', 1, 2, 'HR'], ['E2', 'ORR', 'Higher', 1, 3, 'OR'],
        ...Array.from({ length: 18 }, () => []), ['Interventions'], ['ID', 'Name'],
        ['T1', 'A'], ['T2', 'B'],
      ] },
      { name: '2-Input_NMA_Data', rows: [[], [], ['A', 0.5, 0.2, 0.8, 2, 1.2, 3], ['B', 1, 0.5, 1.5, 0.8, 0.6, 1.1]] },
    ]);
    const analysis = importWorkbook(workbook);
    expect(analysis.comparator).toBe('Chemotherapy');
    expect(analysis.applyWeights).toBe(true);
    expect(analysis.endpoints.map((endpoint) => endpoint.weight)).toEqual(['2', '3']);
    expect(analysis.interventions[0].values[1]).toEqual({ effect: '2', lci: '1.2', uci: '3' });
    const result = calculateAnalysis(analysis);
    expect(result.point.results[0].cells.map((cell) => cell.direction)).toEqual([1, 1]);
    expect(result.interval.results[0].cells.map((cell) => cell.direction)).toEqual([1, 1]);
  });

  it('rejects ambiguous workbook layouts and malformed JSON', () => {
    expect(() => importWorkbook(writeWorkbook([{ name: 'Sheet1', rows: [['Effect']] }]))).toThrow('Unrecognized workbook');
    expect(() => parseAnalysisJson('{bad json')).toThrow('Invalid JSON');
    expect(() => parseAnalysisJson('{"schemaVersion":"other"}')).toThrow('Unsupported schema');
  });
});

import { describe, expect, it } from 'vitest';
import { calculateAnalysis, scoreDirections, validateSetup } from '../src/engine/engine.ts';
import { APP_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from '../src/engine/types.ts';
import type { Analysis, Direction } from '../src/engine/types.ts';

function analysisWith(directions: Array<Array<Direction | null>>, weights = ['', '', '', '']): Analysis {
  const endpoints = ['OS', 'PFS', 'ORR', 'AEs'].map((name, index) => ({ id: `E${index + 1}`, name, favorable: (name === 'ORR' ? 'Higher' : 'Lower') as 'Lower' | 'Higher', nullValue: '1', weight: weights[index], statistic: name === 'OS' || name === 'PFS' ? 'HR' : 'OR' }));
  return {
    schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, engineVersion: ENGINE_VERSION,
    name: 'Test', comparator: 'Control', minimumEndpoints: 2, applyWeights: weights.some((weight) => weight !== ''), endpoints,
    interventions: directions.map((row, rowIndex) => ({
      id: `T${rowIndex + 1}`, name: `Treatment ${rowIndex + 1}`,
      values: row.map((direction, endpointIndex) => ({
        effect: direction === null ? '' : direction === 0 ? '1' : direction > 0 ? (endpointIndex === 2 ? '2' : '0.5') : (endpointIndex === 2 ? '0.5' : '2'),
        lci: direction === null ? '' : direction === 0 ? '0.5' : direction > 0 ? (endpointIndex === 2 ? '1.2' : '0.2') : (endpointIndex === 2 ? '0.2' : '1.2'),
        uci: direction === null ? '' : direction === 0 ? '1.5' : direction > 0 ? (endpointIndex === 2 ? '3' : '0.8') : (endpointIndex === 2 ? '0.8' : '3'),
      })),
    })),
  };
}

function simpleAnalysis(): Analysis {
  const analysis = analysisWith([[1, 1, 1, 1], [0, 0, 0, 0]]);
  analysis.interventions.forEach((intervention) => intervention.values.forEach((value) => { value.effect = '0.5'; value.lci = '0.4'; value.uci = '0.6'; }));
  return analysis;
}

describe('RCA score definitions', () => {
  it('calculates lite, concordant pairs and strict unfavorable penalties', () => {
    expect(scoreDirections([1, 1, 0, 0]).raw).toEqual({ lite: 2, cob: 1, scob: 1 });
    expect(scoreDirections([1, 1, 1, -1]).raw).toEqual({ lite: 2, cob: 3, scob: 0 });
    expect(scoreDirections([0, -1, -1, 1]).raw).toEqual({ lite: -1, cob: -1, scob: -5 });
    expect(scoreDirections([-1, -1, -1, -1]).raw).toEqual({ lite: -4, cob: -6, scob: -6 });
  });

  it('standardizes missing endpoints without treating them as zero', () => {
    const scored = scoreDirections([1, null, -1, 1]);
    expect(scored.k).toBe(3);
    expect(scored.pairs).toBe(3);
    expect(scored.raw).toEqual({ lite: 1, cob: 1, scob: -1 });
    expect(scored.raw.lite * 4 / scored.k).toBeCloseTo(4 / 3);
    expect(scored.raw.cob * 6 / scored.pairs).toBe(2);
    expect(scored.raw.scob * 6 / scored.pairs).toBe(-2);
  });

  it('uses cob before scob and lite as the ranking keys', () => {
    const result = calculateAnalysis(analysisWith([[1, 1, 0, 0], [1, 1, 1, -1]])).point;
    expect(result.results[0].scores).toMatchObject({ lite: 2, cob: 1, scob: 1 });
    expect(result.results.map((row) => row.rank)).toEqual([2, 1]);
  });

  it('retains exact ties with competition ranks and stable display order', () => {
    const result = calculateAnalysis(analysisWith([[1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]])).point;
    expect(result.results.map((row) => row.rank)).toEqual([1, 1, 3]);
    expect(result.sortedEligible.map((row) => row.id)).toEqual(['T1', 'T2', 'T3']);
  });
});

describe('coding and validation boundaries', () => {
  it('distinguishes missing from numeric zero and null equality', () => {
    const analysis = simpleAnalysis();
    analysis.interventions[0].values[0] = { effect: '', lci: '', uci: '' };
    analysis.interventions[0].values[1] = { effect: '0', lci: '-1', uci: '1' };
    analysis.endpoints[1].nullValue = '0';
    const result = calculateAnalysis(analysis);
    expect(result.point.results[0].cells[0]).toMatchObject({ direction: null, status: 'missing' });
    expect(result.point.results[0].cells[1]).toMatchObject({ direction: 0, status: 'ok' });
    expect(result.interval.results[0].cells[1].direction).toBe(0);
    expect(result.point.results[0].k).toBe(3);
  });

  it('codes intervals touching either null boundary as zero', () => {
    const analysis = simpleAnalysis();
    const values = analysis.interventions[0].values;
    values[0] = { effect: '0.5', lci: '0.2', uci: '1' };
    values[1] = { effect: '1.5', lci: '1', uci: '2' };
    const cells = calculateAnalysis(analysis).interval.results[0].cells;
    expect(cells[0]).toMatchObject({ direction: 0, status: 'ok' });
    expect(cells[1]).toMatchObject({ direction: 0, status: 'ok' });
    expect(cells[0].reason).toContain('touches');
  });

  it('requires strict exclusion for favorable and unfavorable interval codes', () => {
    const analysis = simpleAnalysis();
    const values = analysis.interventions[0].values;
    values[0] = { effect: '0.5', lci: '0.2', uci: '0.999999' };
    values[1] = { effect: '1.5', lci: '1.000001', uci: '2' };
    const cells = calculateAnalysis(analysis).interval.results[0].cells;
    expect(cells[0].direction).toBe(1);
    expect(cells[1].direction).toBe(-1);
  });

  it('rejects partial, non-numeric and reversed intervals without scoring', () => {
    for (const [input, status] of [
      [{ effect: '0.5', lci: '', uci: '0.8' }, 'Incomplete CI'],
      [{ effect: '0.5', lci: 'abc', uci: '0.8' }, 'Invalid input'],
      [{ effect: '0.5', lci: '0.9', uci: '0.2' }, 'Invalid CI'],
      [{ effect: '0.95', lci: '0.2', uci: '0.8' }, 'Invalid CI'],
    ] as const) {
      const analysis = simpleAnalysis();
      analysis.interventions[0].values[0] = input;
      const result = calculateAnalysis(analysis);
      expect(result.interval.results[0].cells[0].status).toBe(status);
      expect(result.interval.results[0].status).toBe('Check inputs');
      expect(result.interval.results[0].scores).toBeNull();
      expect(result.interval.results[0].rank).toBeNull();
    }
  });

  it('treats an effect with limits but no effect value as missing for point coding and incomplete for interval coding', () => {
    const analysis = simpleAnalysis();
    analysis.interventions[0].values[0] = { effect: '', lci: '0.2', uci: '0.8' };
    const result = calculateAnalysis(analysis);
    expect(result.point.results[0].cells[0].status).toBe('missing');
    expect(result.interval.results[0].cells[0].status).toBe('Incomplete CI');
  });

  it('blocks interventions below m and excludes them from ranking', () => {
    const analysis = simpleAnalysis();
    analysis.minimumEndpoints = 4;
    analysis.interventions[0].values[0] = { effect: '', lci: '', uci: '' };
    const result = calculateAnalysis(analysis).point;
    expect(result.results[0]).toMatchObject({ status: 'k < m', k: 3, scores: null, rank: null });
    expect(result.results[1].rank).toBe(1);
  });

  it('rejects negative and non-numeric weights even when weighting is disabled', () => {
    const analysis = simpleAnalysis();
    analysis.endpoints[0].weight = '-1';
    expect(validateSetup(analysis)).toContain('OS: weight must be blank or a non-negative number');
    expect(calculateAnalysis(analysis).point.results[0].status).toBe('Invalid setup');
    analysis.endpoints[0].weight = 'abc';
    expect(calculateAnalysis(analysis).point.results[0].status).toBe('Invalid setup');
  });

  it('requires positive observed endpoint and pair weight denominators', () => {
    const analysis = analysisWith([[1, 1, 1, 1]], ['0', '0', '1', '1']);
    analysis.interventions[0].values[2] = { effect: '', lci: '', uci: '' };
    analysis.interventions[0].values[3] = { effect: '', lci: '', uci: '' };
    expect(calculateAnalysis(analysis).point.results[0]).toMatchObject({ status: 'Zero weights', scores: null, rank: null });
  });

  it('validates duplicate names case-insensitively and requires comparator and valid m', () => {
    const analysis = simpleAnalysis();
    analysis.comparator = '';
    analysis.minimumEndpoints = 1;
    analysis.interventions[1].name = analysis.interventions[0].name.toUpperCase();
    const errors = validateSetup(analysis);
    expect(errors).toContain('Set comparator');
    expect(errors).toContain('Minimum endpoints m must be an integer between 2 and n');
    expect(calculateAnalysis(analysis).point.results[0].status).toBe('Set comparator');
    analysis.comparator = 'Control';
    analysis.minimumEndpoints = 2;
    expect(calculateAnalysis(analysis).point.results.map((row) => row.status)).toEqual(['Duplicate name', 'Duplicate name']);
  });
});

describe('weighted calculations', () => {
  it('uses w_i for lite and w_i*w_j for pairs and standardization denominators', () => {
    const scored = scoreDirections([1, 1, null], [2, 3, 4]);
    const W = 9;
    const T = 2 * 3 + 2 * 4 + 3 * 4;
    expect(scored.raw).toEqual({ lite: 5, cob: 6, scob: 6 });
    expect(scored.observedWeight).toBe(5);
    expect(scored.observedPairWeight).toBe(6);
    expect(scored.raw.lite * W / scored.observedWeight).toBe(9);
    expect(scored.raw.cob * T / scored.observedPairWeight).toBe(26);
    expect(scored.pairContributions[0]).toMatchObject({ category: '++', weight: 6, cob: 6, scob: 6 });
  });

  it('applies unfavorable penalties with pair weights', () => {
    const scored = scoreDirections([1, -1, 0], [2, 3, 5]);
    expect(scored.raw).toEqual({ lite: -1, cob: 0, scob: -21 });
    expect(scored.pairContributions.map((pair) => pair.penalty)).toEqual([6, 0, 15]);
  });
});

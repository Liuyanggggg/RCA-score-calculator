import { describe, expect, it } from 'vitest';
import { createPublishedAnalysis } from '../src/engine/analysis.ts';
import { calculateAnalysis, scoreDirections } from '../src/engine/engine.ts';
import referenceJson from '../src/data/publishedExamples.json' with { type: 'json' };
import workedJson from './fixtures/workedExampleDirections.json' with { type: 'json' };

function close(actual: number | null | undefined, expected: number | null, label: string, errors: string[]) {
  if (expected === null) {
    if (actual != null) errors.push(`${label}: expected blank, got ${actual}`);
  } else if (actual == null || Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

describe('latest Supporting Information S3 regression', () => {
  for (const network of referenceJson.networks) {
    it(`${network.name}: every direction, score and rank under both coding rules`, () => {
      const result = calculateAnalysis(createPublishedAnalysis(network.id));
      const errors: string[] = [];
      network.interventions.forEach((reference, index) => {
        for (const rule of ['point', 'interval'] as const) {
          const actual = result[rule].results[index];
          const expected = reference.expected[rule];
          const label = `${network.name} / ${reference.name} / ${rule}`;
          expected.directions.forEach((direction, endpointIndex) => {
            if (actual.cells[endpointIndex].direction !== direction) errors.push(`${label} / ${index}:${endpointIndex} direction expected ${direction}, got ${actual.cells[endpointIndex].direction}`);
          });
          const mathematical = scoreDirections(expected.directions as Array<-1 | 0 | 1 | null>);
          const belowMinimum = reference.expected.k < 2;
          if (belowMinimum) {
            if (actual.status !== 'k < m' || actual.scores !== null) errors.push(`${label}: latest rules require k < m with blocked scores, got ${actual.status}`);
            if (expected.liteStd !== null) close(mathematical.raw.lite * network.endpoints.length / mathematical.k, expected.liteStd, `${label} diagnostic lite* in S3`, errors);
          } else {
            close(actual.scores?.liteStd, expected.liteStd, `${label} lite*`, errors);
            close(actual.scores?.cobStd, expected.cobStd, `${label} cob*`, errors);
            close(actual.scores?.scobStd, expected.scobStd, `${label} scob*`, errors);
          }
          const actualRaw = belowMinimum ? mathematical.raw : actual.scores;
          close(actualRaw?.lite, mathematical.raw.lite, `${label} raw lite`, errors);
          close(actualRaw?.cob, mathematical.raw.cob, `${label} raw cob`, errors);
          close(actualRaw?.scob, mathematical.raw.scob, `${label} raw scob`, errors);
          if (actual.rank !== expected.rank) errors.push(`${label} rank expected ${expected.rank}, got ${actual.rank}`);
          if (rule === 'point') {
            const expectedRaw = reference.expected.point;
            close(actualRaw?.lite, expectedRaw.lite, `${label} published raw lite`, errors);
            close(actualRaw?.cob, expectedRaw.cob, `${label} published raw cob`, errors);
            close(actualRaw?.scob, expectedRaw.scob, `${label} published raw scob`, errors);
          }
        }
        if (result.point.results[index].k !== reference.expected.k) errors.push(`${network.name} / ${reference.name}: k expected ${reference.expected.k}, got ${result.point.results[index].k}`);
      });
      expect(errors).toEqual([]);
    });
  }
});

describe('main-manuscript worked example direction matrix', () => {
  it('reproduces all 9 regimens and both 18 reported profiles', () => {
    const errors: string[] = [];
    for (const rule of ['pt', 'CI'] as const) {
      const rows = workedJson.filter((row) => row.rule === rule);
      const scores = rows.map((row) => {
        const scored = scoreDirections(row.directions as Array<-1 | 0 | 1 | null>);
        return {
          ...scored.raw,
          liteStd: scored.raw.lite * 4 / scored.k,
          cobStd: scored.raw.cob * 6 / scored.pairs,
          scobStd: scored.raw.scob * 6 / scored.pairs,
        };
      });
      rows.forEach((row, index) => {
        const actual = scores[index];
        close(actual.lite, row.lite, `${row.name}/${rule} lite`, errors);
        close(actual.cob, row.cob, `${row.name}/${rule} cob`, errors);
        close(actual.scob, row.scob, `${row.name}/${rule} scob`, errors);
        close(actual.liteStd, row.liteStd, `${row.name}/${rule} lite*`, errors);
        close(actual.cobStd, row.cobStd, `${row.name}/${rule} cob*`, errors);
        close(actual.scobStd, row.scobStd, `${row.name}/${rule} scob*`, errors);
        const rank = 1 + scores.filter((other) => other.cobStd > actual.cobStd || (other.cobStd === actual.cobStd && other.scobStd > actual.scobStd) || (other.cobStd === actual.cobStd && other.scobStd === actual.scobStd && other.liteStd > actual.liteStd)).length;
        if (rank !== row.rank) errors.push(`${row.name}/${rule} rank expected ${row.rank}, got ${rank}`);
      });
    }
    expect(errors).toEqual([]);
  });
});

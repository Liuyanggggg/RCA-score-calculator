import type {
  Analysis,
  AnalysisResult,
  CodingRule,
  Direction,
  DirectionCell,
  Endpoint,
  InterventionResult,
  PairContribution,
  RuleResult,
  ScoreSet,
} from './types.ts';

const numericPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || !numericPattern.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function effectiveWeight(endpoint: Endpoint, applyWeights: boolean): number {
  if (!applyWeights) return 1;
  return endpoint.weight.trim() === '' ? 1 : parseNumeric(endpoint.weight) ?? Number.NaN;
}

export function validateSetup(analysis: Analysis): string[] {
  const errors: string[] = [];
  if (!analysis.comparator.trim()) errors.push('Set comparator');
  if (analysis.endpoints.length < 2 || analysis.endpoints.length > 20) errors.push('Define between 2 and 20 endpoints');
  if (analysis.interventions.length > 50) errors.push('Define no more than 50 interventions');
  if (!Number.isInteger(analysis.minimumEndpoints) || analysis.minimumEndpoints < 2 || analysis.minimumEndpoints > analysis.endpoints.length) {
    errors.push('Minimum endpoints m must be an integer between 2 and n');
  }
  const endpointNames = analysis.endpoints.map((endpoint) => normalizedName(endpoint.name));
  if (endpointNames.some((name) => !name)) errors.push('Every endpoint needs a name');
  if (new Set(endpointNames).size !== endpointNames.length) errors.push('Endpoint names must be unique');
  for (const endpoint of analysis.endpoints) {
    const label = endpoint.name.trim() || endpoint.id;
    if (!['Lower', 'Higher'].includes(endpoint.favorable)) errors.push(`${label}: favorable direction must be Lower or Higher`);
    if (parseNumeric(endpoint.nullValue) === null) errors.push(`${label}: null value must be numeric`);
    if (endpoint.weight.trim() !== '' && (parseNumeric(endpoint.weight) === null || (parseNumeric(endpoint.weight) as number) < 0)) {
      errors.push(`${label}: weight must be blank or a non-negative number`);
    }
  }
  return errors;
}

function codeCell(endpoint: Endpoint, input: { effect: string; lci: string; uci: string }, rule: CodingRule): DirectionCell {
  const effectText = input.effect.trim();
  const lciText = input.lci.trim();
  const uciText = input.uci.trim();
  const nullValue = parseNumeric(endpoint.nullValue) as number;
  if (rule === 'point') {
    if (!effectText) return { endpointId: endpoint.id, direction: null, status: 'missing', reason: 'Missing effect; excluded, not coded as 0.' };
    const effect = parseNumeric(effectText);
    if (effect === null) return { endpointId: endpoint.id, direction: null, status: 'Invalid input', reason: 'Effect is not numeric.' };
    const direction: Direction = effect === nullValue ? 0 : (endpoint.favorable === 'Lower' ? effect < nullValue : effect > nullValue) ? 1 : -1;
    const relation = effect === nullValue ? 'equals' : direction === 1 ? 'is on the favorable side of' : 'is on the unfavorable side of';
    return { endpointId: endpoint.id, direction, status: 'ok', reason: `Effect ${effectText} ${relation} null ${endpoint.nullValue}; ${endpoint.favorable.toLowerCase()} is favorable.` };
  }
  if (!effectText && !lciText && !uciText) return { endpointId: endpoint.id, direction: null, status: 'missing', reason: 'Effect and both limits are blank; excluded, not coded as 0.' };
  if (!effectText || !lciText || !uciText) return { endpointId: endpoint.id, direction: null, status: 'Incomplete CI', reason: 'Effect, LCI and UCI must either all be blank or all be numeric.' };
  const effect = parseNumeric(effectText);
  const lci = parseNumeric(lciText);
  const uci = parseNumeric(uciText);
  if (effect === null || lci === null || uci === null) return { endpointId: endpoint.id, direction: null, status: 'Invalid input', reason: 'Effect and both interval limits must be numeric.' };
  if (lci > uci || effect < lci || effect > uci) return { endpointId: endpoint.id, direction: null, status: 'Invalid CI', reason: 'Required order: LCI <= effect <= UCI.' };
  let direction: Direction = 0;
  if (endpoint.favorable === 'Lower') {
    if (uci < nullValue) direction = 1;
    else if (lci > nullValue) direction = -1;
  } else {
    if (lci > nullValue) direction = 1;
    else if (uci < nullValue) direction = -1;
  }
  const reason = direction === 0
    ? `Interval [${lciText}, ${uciText}] includes or touches null ${endpoint.nullValue}; coded 0 (strict inequalities).`
    : `Interval [${lciText}, ${uciText}] strictly excludes null ${endpoint.nullValue} on the ${direction === 1 ? 'favorable' : 'unfavorable'} side.`;
  return { endpointId: endpoint.id, direction, status: 'ok', reason };
}

export function scoreDirections(directions: Array<Direction | null>, weights: number[] = directions.map(() => 1)): {
  k: number;
  pairs: number;
  observedWeight: number;
  observedPairWeight: number;
  pairContributions: PairContribution[];
  raw: Pick<ScoreSet, 'lite' | 'cob' | 'scob'>;
} {
  const observed = directions.flatMap((direction, index) => direction === null ? [] : [{ direction, index }]);
  let lite = 0;
  let cob = 0;
  let penaltyTotal = 0;
  let observedWeight = 0;
  let observedPairWeight = 0;
  const pairContributions: PairContribution[] = [];
  for (const item of observed) lite += item.direction * weights[item.index];
  for (const item of observed) observedWeight += weights[item.index];
  for (let a = 0; a < observed.length; a += 1) {
    for (let b = a + 1; b < observed.length; b += 1) {
      const left = observed[a];
      const right = observed[b];
      const weight = weights[left.index] * weights[right.index];
      observedPairWeight += weight;
      const category = left.direction === 1 && right.direction === 1 ? '++'
        : left.direction === -1 && right.direction === -1 ? '--'
          : left.direction * right.direction === -1 ? '+/-'
            : (left.direction === 0 && right.direction === -1) || (right.direction === 0 && left.direction === -1) ? '0/-' : 'other';
      const cobContribution = category === '++' ? weight : category === '--' ? -weight : 0;
      const penalty = category === '+/-' || category === '0/-' ? weight : 0;
      cob += cobContribution;
      penaltyTotal += penalty;
      pairContributions.push({
        leftEndpointId: String(left.index), rightEndpointId: String(right.index), leftName: '', rightName: '',
        leftDirection: left.direction, rightDirection: right.direction, weight, category,
        cob: cobContribution, penalty, scob: cobContribution - penalty,
      });
    }
  }
  return {
    k: observed.length,
    pairs: observed.length * (observed.length - 1) / 2,
    observedWeight,
    observedPairWeight,
    pairContributions,
    raw: { lite, cob, scob: cob - penaltyTotal },
  };
}

function calculateRule(analysis: Analysis, rule: CodingRule): RuleResult {
  const setupErrors = validateSetup(analysis);
  const weights = analysis.endpoints.map((endpoint) => effectiveWeight(endpoint, analysis.applyWeights));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let totalPairWeight = 0;
  for (let i = 0; i < weights.length; i += 1) for (let j = i + 1; j < weights.length; j += 1) totalPairWeight += weights[i] * weights[j];
  const interventionNames = analysis.interventions.map((intervention) => normalizedName(intervention.name));
  const results: InterventionResult[] = analysis.interventions.map((intervention, sourceIndex) => {
    const cells = analysis.endpoints.map((endpoint, endpointIndex) => codeCell(
      endpoint,
      intervention.values[endpointIndex] ?? { effect: '', lci: '', uci: '' },
      rule,
    ));
    const directions = cells.map((cell) => cell.direction);
    const scored = scoreDirections(directions, weights);
    scored.pairContributions.forEach((pair) => {
      const left = Number(pair.leftEndpointId);
      const right = Number(pair.rightEndpointId);
      pair.leftEndpointId = analysis.endpoints[left].id;
      pair.rightEndpointId = analysis.endpoints[right].id;
      pair.leftName = analysis.endpoints[left].name;
      pair.rightName = analysis.endpoints[right].name;
    });
    let status: InterventionResult['status'] = 'Ready';
    let statusReason = 'Eligible for scores and ranking.';
    if (!analysis.comparator.trim()) [status, statusReason] = ['Set comparator', 'Comparator is required.'];
    else if (setupErrors.length) [status, statusReason] = ['Invalid setup', setupErrors.join(' ')];
    else if (!intervention.name.trim()) [status, statusReason] = ['Check inputs', 'Intervention name is required.'];
    else if (interventionNames.filter((name) => name === normalizedName(intervention.name)).length > 1) [status, statusReason] = ['Duplicate name', 'Intervention names must be unique.'];
    else if (cells.some((cell) => !['ok', 'missing'].includes(cell.status))) [status, statusReason] = ['Check inputs', 'At least one input is invalid or incomplete.'];
    else if (scored.k < analysis.minimumEndpoints) [status, statusReason] = ['k < m', `Only ${scored.k} observed endpoints; m = ${analysis.minimumEndpoints}. Scores and rank are blocked.`];
    else if (scored.observedWeight <= 0 || scored.observedPairWeight <= 0) [status, statusReason] = ['Zero weights', 'Observed endpoint and pair weights must both be positive for standardization.'];
    const eligible = status === 'Ready';
    const liteFactor = eligible && scored.observedWeight > 0 ? totalWeight / scored.observedWeight : null;
    const pairFactor = eligible && scored.observedPairWeight > 0 ? totalPairWeight / scored.observedPairWeight : null;
    const scores = eligible && liteFactor !== null && pairFactor !== null ? {
      ...scored.raw,
      liteStd: scored.raw.lite * liteFactor,
      cobStd: scored.raw.cob * pairFactor,
      scobStd: scored.raw.scob * pairFactor,
    } : null;
    return {
      id: intervention.id, name: intervention.name, sourceIndex, k: scored.k, pairs: scored.pairs,
      cells, pairContributions: scored.pairContributions, scores, totalWeight,
      observedWeight: scored.observedWeight, totalPairWeight, observedPairWeight: scored.observedPairWeight,
      liteFactor, pairFactor, status, statusReason, rank: null,
    };
  });
  const sortedEligible = results.filter((result) => result.status === 'Ready' && result.scores).sort((a, b) => {
    const left = a.scores as ScoreSet;
    const right = b.scores as ScoreSet;
    return right.cobStd - left.cobStd || right.scobStd - left.scobStd || right.liteStd - left.liteStd || a.sourceIndex - b.sourceIndex;
  });
  for (const result of sortedEligible) {
    const scores = result.scores as ScoreSet;
    result.rank = 1 + sortedEligible.filter((other) => {
      const candidate = other.scores as ScoreSet;
      return candidate.cobStd > scores.cobStd
        || (candidate.cobStd === scores.cobStd && candidate.scobStd > scores.scobStd)
        || (candidate.cobStd === scores.cobStd && candidate.scobStd === scores.scobStd && candidate.liteStd > scores.liteStd);
    }).length;
  }
  return { rule, label: rule === 'point' ? 'Point-estimate coding' : '95% interval-exclusion coding', setupErrors, results, sortedEligible };
}

export function calculateAnalysis(analysis: Analysis): AnalysisResult {
  return { point: calculateRule(analysis, 'point'), interval: calculateRule(analysis, 'interval') };
}

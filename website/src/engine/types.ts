export const APP_VERSION = '1.0.0';
export const ENGINE_VERSION = '1.0.0';
export const SCHEMA_VERSION = 'rca-analysis/1.0';

export type CodingRule = 'point' | 'interval';
export type Direction = -1 | 0 | 1;
export type FavorableDirection = 'Lower' | 'Higher';

export interface EffectInput {
  effect: string;
  lci: string;
  uci: string;
}

export interface Endpoint {
  id: string;
  name: string;
  favorable: FavorableDirection;
  nullValue: string;
  weight: string;
  statistic: string;
}

export interface Intervention {
  id: string;
  name: string;
  values: EffectInput[];
}

export interface Analysis {
  schemaVersion: typeof SCHEMA_VERSION;
  appVersion: string;
  engineVersion: string;
  name: string;
  comparator: string;
  minimumEndpoints: number;
  applyWeights: boolean;
  endpoints: Endpoint[];
  interventions: Intervention[];
}

export type DirectionStatus = 'ok' | 'missing' | 'Invalid input' | 'Incomplete CI' | 'Invalid CI';

export interface DirectionCell {
  endpointId: string;
  direction: Direction | null;
  status: DirectionStatus;
  reason: string;
}

export interface PairContribution {
  leftEndpointId: string;
  rightEndpointId: string;
  leftName: string;
  rightName: string;
  leftDirection: Direction;
  rightDirection: Direction;
  weight: number;
  category: '++' | '--' | '+/-' | '0/-' | 'other';
  cob: number;
  penalty: number;
  scob: number;
}

export interface ScoreSet {
  lite: number;
  cob: number;
  scob: number;
  liteStd: number;
  cobStd: number;
  scobStd: number;
}

export interface InterventionResult {
  id: string;
  name: string;
  sourceIndex: number;
  k: number;
  pairs: number;
  cells: DirectionCell[];
  pairContributions: PairContribution[];
  scores: ScoreSet | null;
  totalWeight: number;
  observedWeight: number;
  totalPairWeight: number;
  observedPairWeight: number;
  liteFactor: number | null;
  pairFactor: number | null;
  status: 'Ready' | 'Set comparator' | 'Invalid setup' | 'Duplicate name' | 'Check inputs' | 'k < m' | 'Zero weights';
  statusReason: string;
  rank: number | null;
}

export interface RuleResult {
  rule: CodingRule;
  label: string;
  setupErrors: string[];
  results: InterventionResult[];
  sortedEligible: InterventionResult[];
}

export interface AnalysisResult {
  point: RuleResult;
  interval: RuleResult;
}

export interface WorkbookSheet {
  name: string;
  rows: Array<Array<string | number | null>>;
}

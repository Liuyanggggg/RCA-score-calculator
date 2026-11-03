import examplesJson from '../data/publishedExamples.json' with { type: 'json' };
import { APP_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from './types.ts';
import type { Analysis, EffectInput, Endpoint, Intervention } from './types.ts';

interface PublishedNetwork {
  id: string;
  name: string;
  comparator: string;
  minimumEndpoints: number;
  applyWeights: boolean;
  endpoints: Array<Omit<Endpoint, 'id'>>;
  interventions: Array<{ name: string; values: EffectInput[] }>;
}

export const publishedNetworks = (examplesJson as unknown as { networks: PublishedNetwork[] }).networks;

export function blankEffect(): EffectInput {
  return { effect: '', lci: '', uci: '' };
}

export function createBlankAnalysis(): Analysis {
  const endpoints = ['OS', 'PFS'].map((name, index): Endpoint => ({
    id: `E${index + 1}`, name, favorable: 'Lower', nullValue: '1', weight: '', statistic: 'HR',
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    engineVersion: ENGINE_VERSION,
    name: 'Untitled RCA analysis',
    comparator: '',
    minimumEndpoints: 2,
    applyWeights: false,
    endpoints,
    interventions: [{ id: 'T1', name: 'Intervention 1', values: endpoints.map(blankEffect) }],
  };
}

export function createPublishedAnalysis(networkId = publishedNetworks[0].id): Analysis {
  const network = publishedNetworks.find((item) => item.id === networkId);
  if (!network) throw new Error(`Unknown published network: ${networkId}`);
  const endpoints = network.endpoints.map((endpoint, index) => ({ ...endpoint, id: `E${index + 1}` }));
  const interventions: Intervention[] = network.interventions.map((intervention, index) => ({
    id: `T${index + 1}`, name: intervention.name, values: intervention.values.map((value) => ({ ...value })),
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    engineVersion: ENGINE_VERSION,
    name: network.name,
    comparator: network.comparator,
    minimumEndpoints: network.minimumEndpoints,
    applyWeights: network.applyWeights,
    endpoints,
    interventions,
  };
}

export function normalizeAnalysis(input: Analysis): Analysis {
  if (input.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${String(input.schemaVersion)}`);
  if (!Array.isArray(input.endpoints) || !Array.isArray(input.interventions)) throw new Error('Analysis endpoints and interventions must be arrays.');
  if (input.endpoints.length > 20 || input.interventions.length > 50) throw new Error('Analysis exceeds the 20-endpoint or 50-intervention limit.');
  const endpointIds = new Set<string>();
  const endpoints = input.endpoints.map((endpoint, index) => {
    if (!endpoint || typeof endpoint.name !== 'string') throw new Error(`Invalid endpoint at position ${index + 1}.`);
    const id = typeof endpoint.id === 'string' && endpoint.id ? endpoint.id : `E${index + 1}`;
    if (endpointIds.has(id)) throw new Error(`Duplicate endpoint ID: ${id}`);
    endpointIds.add(id);
    return {
      id, name: endpoint.name, favorable: endpoint.favorable,
      nullValue: String(endpoint.nullValue ?? ''), weight: String(endpoint.weight ?? ''), statistic: String(endpoint.statistic ?? ''),
    };
  });
  const interventionIds = new Set<string>();
  const interventions = input.interventions.map((intervention, index) => {
    if (!intervention || typeof intervention.name !== 'string' || !Array.isArray(intervention.values)) throw new Error(`Invalid intervention at position ${index + 1}.`);
    const id = typeof intervention.id === 'string' && intervention.id ? intervention.id : `T${index + 1}`;
    if (interventionIds.has(id)) throw new Error(`Duplicate intervention ID: ${id}`);
    interventionIds.add(id);
    return {
      id, name: intervention.name,
      values: endpoints.map((_, endpointIndex) => {
        const value = intervention.values[endpointIndex] ?? blankEffect();
        return { effect: String(value.effect ?? ''), lci: String(value.lci ?? ''), uci: String(value.uci ?? '') };
      }),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    engineVersion: ENGINE_VERSION,
    name: String(input.name ?? 'Untitled RCA analysis'),
    comparator: String(input.comparator ?? ''),
    minimumEndpoints: Number(input.minimumEndpoints),
    applyWeights: Boolean(input.applyWeights),
    endpoints,
    interventions,
  };
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export async function analysisDigest(analysis: Analysis): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(analysis));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

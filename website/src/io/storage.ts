import { normalizeAnalysis } from '../engine/analysis.ts';
import type { Analysis } from '../engine/types.ts';

const STORAGE_KEY = 'rca-calculator.saved-analyses.v1';

interface SavedRecord {
  name: string;
  savedAt: string;
  analysis: Analysis;
}

function readRecords(): SavedRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SavedRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listSavedAnalyses(): Array<{ name: string; savedAt: string }> {
  return readRecords().map(({ name, savedAt }) => ({ name, savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveAnalysis(name: string, analysis: Analysis): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a name for this saved analysis.');
  const records = readRecords().filter((record) => record.name !== trimmed);
  records.push({ name: trimmed, savedAt: new Date().toISOString(), analysis });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function loadAnalysis(name: string): Analysis {
  const record = readRecords().find((item) => item.name === name);
  if (!record) throw new Error(`Saved analysis not found: ${name}`);
  return normalizeAnalysis(record.analysis);
}

export function deleteAnalysis(name: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readRecords().filter((record) => record.name !== name)));
}

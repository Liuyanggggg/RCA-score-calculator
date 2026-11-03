import { useEffect, useMemo, useRef, useState } from 'react';
import { analysisDigest, blankEffect, createBlankAnalysis, createPublishedAnalysis, normalizeAnalysis, publishedNetworks } from './engine/analysis.ts';
import { calculateAnalysis } from './engine/engine.ts';
import { APP_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from './engine/types.ts';
import type { Analysis, CodingRule, Direction, Endpoint, RuleResult } from './engine/types.ts';
import { analysisWorkbook, exportAnalysisJson, importWorkbook, parseAnalysisJson, templateWorkbook } from './io/workbook.ts';
import { downloadBlob, safeFilename } from './io/download.ts';
import { deleteAnalysis, listSavedAnalyses, loadAnalysis, saveAnalysis } from './io/storage.ts';

const tabs = ['Setup', 'Data', 'Results', 'Compare', 'Audit', 'Save & export', 'Method'] as const;
type Tab = typeof tabs[number];

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  if (Object.is(value, -0)) return '0';
  return Math.abs(value) >= 100000 || (Math.abs(value) > 0 && Math.abs(value) < 0.0001) ? value.toExponential(6) : Number(value.toFixed(10)).toString();
}

function directionLabel(value: Direction | null): string {
  return value === null ? 'NA' : value > 0 ? '+1' : String(value);
}

function nextId(prefix: string, items: Array<{ id: string }>): string {
  const maximum = items.reduce((max, item) => {
    const match = item.id.match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}${maximum + 1}`;
}

function RuleTable({ rule, onAudit }: { rule: RuleResult; onAudit: (id: string, rule: CodingRule) => void }) {
  const ordered = [...rule.results].sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.sourceIndex - b.sourceIndex;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.sourceIndex - b.sourceIndex;
  });
  return (
    <div className="table-scroll">
      <table className="results-table">
        <thead><tr><th>Rank</th><th className="sticky-name">Intervention</th><th>k / M</th><th>lite</th><th>cob</th><th>scob</th><th>lite*</th><th>cob*</th><th>scob*</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead>
        <tbody>{ordered.map((result) => <tr key={result.id} className={result.status === 'Ready' ? '' : 'muted-row'}>
          <td><span className="rank-badge">{result.rank ?? '—'}</span></td>
          <td className="sticky-name"><strong>{result.name || '(unnamed)'}</strong></td>
          <td>{result.k} / {result.pairs}</td>
          <td>{formatNumber(result.scores?.lite)}</td><td>{formatNumber(result.scores?.cob)}</td><td>{formatNumber(result.scores?.scob)}</td>
          <td>{formatNumber(result.scores?.liteStd)}</td><td className="key-score">{formatNumber(result.scores?.cobStd)}</td><td>{formatNumber(result.scores?.scobStd)}</td>
          <td><span className={`status ${result.status === 'Ready' ? 'ready' : 'blocked'}`} title={result.statusReason}>{result.status}</span></td>
          <td><button className="link-button" type="button" onClick={() => onAudit(result.id, rule.rule)}>Details</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function RuleSummary({ rule }: { rule: RuleResult }) {
  const eligible = rule.results.filter((result) => result.status === 'Ready').length;
  const tied = rule.results.filter((result) => result.rank !== null && rule.results.filter((other) => other.rank === result.rank).length > 1).length;
  return <div className="summary-strip"><span><strong>{eligible}</strong> eligible</span><span><strong>{rule.results.length - eligible}</strong> blocked</span><span><strong>{tied}</strong> in exact ties</span><span>Sorted by <strong>cob* → scob* → lite*</strong></span></div>;
}

export default function App() {
  const [analysis, setAnalysis] = useState<Analysis>(() => createPublishedAnalysis());
  const [activeTab, setActiveTab] = useState<Tab>('Setup');
  const [resultRule, setResultRule] = useState<CodingRule>('point');
  const [auditRule, setAuditRule] = useState<CodingRule>('point');
  const [auditId, setAuditId] = useState(analysis.interventions[0]?.id ?? '');
  const [exampleId, setExampleId] = useState(publishedNetworks[0].id);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saveName, setSaveName] = useState(analysis.name);
  const [saved, setSaved] = useState(() => listSavedAnalyses());
  const [digest, setDigest] = useState('Calculating…');
  const excelInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const result = useMemo(() => calculateAnalysis(analysis), [analysis]);

  useEffect(() => {
    let current = true;
    analysisDigest(analysis).then((value) => { if (current) setDigest(value); }).catch(() => { if (current) setDigest('Unavailable'); });
    return () => { current = false; };
  }, [analysis]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function replaceAnalysis(next: Analysis, message: string) {
    const normalized = normalizeAnalysis(next);
    setAnalysis(normalized);
    setSaveName(normalized.name);
    setAuditId(normalized.interventions[0]?.id ?? '');
    setNotice({ type: 'success', text: message });
  }

  function updateAnalysis(patch: Partial<Analysis>) {
    setAnalysis((current) => ({ ...current, ...patch }));
  }

  function updateEndpoint(index: number, patch: Partial<Endpoint>) {
    setAnalysis((current) => ({ ...current, endpoints: current.endpoints.map((endpoint, itemIndex) => itemIndex === index ? { ...endpoint, ...patch } : endpoint) }));
  }

  function addEndpoint() {
    if (analysis.endpoints.length >= 20) return;
    setAnalysis((current) => {
      const endpoint: Endpoint = { id: nextId('E', current.endpoints), name: `Endpoint ${current.endpoints.length + 1}`, favorable: 'Lower', nullValue: '1', weight: '', statistic: '' };
      return { ...current, endpoints: [...current.endpoints, endpoint], interventions: current.interventions.map((intervention) => ({ ...intervention, values: [...intervention.values, blankEffect()] })) };
    });
  }

  function removeEndpoint(index: number) {
    if (analysis.endpoints.length <= 2) return;
    setAnalysis((current) => ({
      ...current,
      endpoints: current.endpoints.filter((_, itemIndex) => itemIndex !== index),
      interventions: current.interventions.map((intervention) => ({ ...intervention, values: intervention.values.filter((_, itemIndex) => itemIndex !== index) })),
      minimumEndpoints: Math.min(current.minimumEndpoints, current.endpoints.length - 1),
    }));
  }

  function addIntervention() {
    if (analysis.interventions.length >= 50) return;
    setAnalysis((current) => ({
      ...current,
      interventions: [...current.interventions, { id: nextId('T', current.interventions), name: `Intervention ${current.interventions.length + 1}`, values: current.endpoints.map(blankEffect) }],
    }));
  }

  function removeIntervention(index: number) {
    setAnalysis((current) => ({ ...current, interventions: current.interventions.filter((_, itemIndex) => itemIndex !== index) }));
  }

  function updateInterventionName(index: number, name: string) {
    setAnalysis((current) => ({ ...current, interventions: current.interventions.map((intervention, itemIndex) => itemIndex === index ? { ...intervention, name } : intervention) }));
  }

  function updateEffect(interventionIndex: number, endpointIndex: number, field: 'effect' | 'lci' | 'uci', value: string) {
    setAnalysis((current) => ({
      ...current,
      interventions: current.interventions.map((intervention, itemIndex) => itemIndex === interventionIndex ? {
        ...intervention,
        values: intervention.values.map((input, itemEndpointIndex) => itemEndpointIndex === endpointIndex ? { ...input, [field]: value } : input),
      } : intervention),
    }));
  }

  async function onExcelFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = importWorkbook(await file.arrayBuffer());
      replaceAnalysis(imported, `Imported ${file.name}. Both rules were recalculated from the raw inputs.`);
      setActiveTab('Data');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Excel import failed.' });
    } finally {
      if (excelInput.current) excelInput.current.value = '';
    }
  }

  async function onJsonFile(file: File | undefined) {
    if (!file) return;
    try {
      replaceAnalysis(parseAnalysisJson(await file.text()), `Loaded ${file.name}; inputs, parameters and versions were restored.`);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'JSON import failed.' });
    } finally {
      if (jsonInput.current) jsonInput.current.value = '';
    }
  }

  async function exportJson() {
    const currentDigest = await analysisDigest(analysis);
    setDigest(currentDigest);
    downloadBlob(exportAnalysisJson(analysis, currentDigest), `${safeFilename(analysis.name)}.rca.json`, 'application/json');
  }

  async function exportExcel() {
    const currentDigest = await analysisDigest(analysis);
    setDigest(currentDigest);
    const workbook = analysisWorkbook(analysis, currentDigest);
    downloadBlob(workbook.buffer as ArrayBuffer, `${safeFilename(analysis.name)}-results.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function openAudit(id: string, rule: CodingRule) {
    setAuditId(id);
    setAuditRule(rule);
    setActiveTab('Audit');
  }

  const selectedAudit = result[auditRule].results.find((item) => item.id === auditId) ?? result[auditRule].results[0];
  const selectedInput = analysis.interventions.find((item) => item.id === selectedAudit?.id);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand-mark">RCA</div>
        <div className="brand-copy"><h1>RCA Score Calculator</h1><p>Response-Consistency-Across-endpoints</p></div>
        <div className="local-badge"><span></span> Local-first · no account</div>
      </header>
      <div className="subheader"><span>Multi-outcome screening for network meta-analysis</span><span>v{APP_VERSION} · Engine {ENGINE_VERSION}</span></div>
      <nav className="main-nav" aria-label="Analysis workflow">
        {tabs.map((tab, index) => <button type="button" key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}><span>{index + 1}</span>{tab}</button>)}
      </nav>
      {notice && <div className={`notice ${notice.type}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
      <main>
        {activeTab === 'Setup' && <section>
          <div className="section-heading"><div><p className="eyebrow">01 · Define the analysis</p><h2>Setup</h2><p>Prespecify the comparator, endpoint coding and coverage threshold.</p></div><button className="secondary" type="button" onClick={() => replaceAnalysis(createBlankAnalysis(), 'Started a blank analysis.')}>New blank analysis</button></div>
          <div className="card form-card">
            <div className="form-grid">
              <label className="field wide"><span>Analysis name</span><input value={analysis.name} onChange={(event) => { updateAnalysis({ name: event.target.value }); setSaveName(event.target.value); }} /></label>
              <label className="field wide"><span>Common comparator <b>*</b></span><input value={analysis.comparator} placeholder="e.g. Chemotherapy" onChange={(event) => updateAnalysis({ comparator: event.target.value })} /></label>
              <label className="field"><span>Minimum observed endpoints (m)</span><input type="number" min="2" max={analysis.endpoints.length} step="1" value={analysis.minimumEndpoints} onChange={(event) => updateAnalysis({ minimumEndpoints: Number(event.target.value) })} /><small>Scores require k ≥ m ≥ 2.</small></label>
              <label className="field"><span>Endpoint weighting</span><select value={analysis.applyWeights ? 'Yes' : 'No'} onChange={(event) => updateAnalysis({ applyWeights: event.target.value === 'Yes' })}><option>No</option><option>Yes</option></select><small>Blank weights equal 1 when enabled.</small></label>
            </div>
          </div>
          {result.point.setupErrors.length > 0 && <div className="validation-box"><strong>Setup needs attention</strong><ul>{result.point.setupErrors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
          <div className="card">
            <div className="card-heading"><div><h3>Endpoints <span>{analysis.endpoints.length} / 20</span></h3><p>Null-based coding only; separate clinical thresholds are not applied.</p></div><button type="button" className="secondary" onClick={addEndpoint} disabled={analysis.endpoints.length >= 20}>+ Add endpoint</button></div>
            <div className="table-scroll"><table className="edit-table"><thead><tr><th>ID</th><th>Endpoint name</th><th>Favorable direction</th><th>Null value</th><th>Optional weight</th><th>Statistic</th><th></th></tr></thead><tbody>
              {analysis.endpoints.map((endpoint, index) => <tr key={endpoint.id}><td><span className="id-chip">{endpoint.id}</span></td><td><input aria-label={`${endpoint.id} name`} value={endpoint.name} onChange={(event) => updateEndpoint(index, { name: event.target.value })} /></td><td><select aria-label={`${endpoint.id} favorable direction`} value={endpoint.favorable} onChange={(event) => updateEndpoint(index, { favorable: event.target.value as 'Lower' | 'Higher' })}><option>Lower</option><option>Higher</option></select></td><td><input aria-label={`${endpoint.id} null value`} value={endpoint.nullValue} onChange={(event) => updateEndpoint(index, { nullValue: event.target.value })} /></td><td><input aria-label={`${endpoint.id} weight`} value={endpoint.weight} placeholder="Blank = 1" disabled={!analysis.applyWeights} onChange={(event) => updateEndpoint(index, { weight: event.target.value })} /></td><td><input aria-label={`${endpoint.id} statistic`} value={endpoint.statistic} placeholder="HR, OR…" onChange={(event) => updateEndpoint(index, { statistic: event.target.value })} /></td><td><button type="button" className="icon-button" disabled={analysis.endpoints.length <= 2} onClick={() => removeEndpoint(index)} aria-label={`Remove ${endpoint.name}`}>×</button></td></tr>)}
            </tbody></table></div>
          </div>
          <div className="card">
            <div className="card-heading"><div><h3>Interventions <span>{analysis.interventions.length} / 50</span></h3><p>Names must be unique. Enter effect data on the next tab.</p></div><button type="button" className="secondary" onClick={addIntervention} disabled={analysis.interventions.length >= 50}>+ Add intervention</button></div>
            <div className="intervention-grid">{analysis.interventions.map((intervention, index) => <div className="intervention-editor" key={intervention.id}><span className="id-chip">{intervention.id}</span><input aria-label={`${intervention.id} name`} value={intervention.name} onChange={(event) => updateInterventionName(index, event.target.value)} /><button type="button" className="icon-button" onClick={() => removeIntervention(index)} aria-label={`Remove ${intervention.name}`}>×</button></div>)}</div>
          </div>
          <div className="section-actions"><span>Next: enter or import effect estimates and 95% intervals.</span><button type="button" className="primary" onClick={() => setActiveTab('Data')}>Continue to data →</button></div>
        </section>}

        {activeTab === 'Data' && <section>
          <div className="section-heading"><div><p className="eyebrow">02 · Supply evidence</p><h2>Effect data</h2><p>Enter published effects and intervals exactly as reported. Blank is missing; numeric 0 is observed.</p></div><button type="button" className="primary" onClick={() => setActiveTab('Results')}>Calculate & view results →</button></div>
          <div className="data-toolbar card">
            <div className="example-picker"><label htmlFor="published-example">Published example from Supporting Information S3</label><div><select id="published-example" value={exampleId} onChange={(event) => setExampleId(event.target.value)}>{publishedNetworks.map((network) => <option key={network.id} value={network.id}>{network.name} · {network.interventions.length} regimens</option>)}</select><button type="button" className="secondary" onClick={() => replaceAnalysis(createPublishedAnalysis(exampleId), 'Published example loaded. All scores are recalculated locally.')}>Load example</button></div></div>
            <div className="toolbar-actions"><button type="button" className="secondary" onClick={() => excelInput.current?.click()}>Import Excel</button><input ref={excelInput} className="sr-only" type="file" accept=".xlsx" aria-label="Import Excel file" onChange={(event) => void onExcelFile(event.target.files?.[0])} /><button type="button" className="ghost" onClick={() => { const template = templateWorkbook(); downloadBlob(template.buffer as ArrayBuffer, 'RCA-input-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }}>Download template</button></div>
          </div>
          <div className="legend"><span><i className="dot favorable"></i> +1 favorable</span><span><i className="dot neutral"></i> 0 neutral / uncertain</span><span><i className="dot unfavorable"></i> −1 unfavorable</span><span><i className="dot missing"></i> NA missing</span><span>Interval coding requires LCI ≤ effect ≤ UCI.</span></div>
          <div className="card data-card"><div className="table-scroll data-scroll"><table className="data-table"><thead><tr><th className="sticky-name" rowSpan={2}>Intervention</th>{analysis.endpoints.map((endpoint) => <th key={endpoint.id} colSpan={3}><span>{endpoint.name}</span><small>{endpoint.statistic || 'Effect'} · {endpoint.favorable} favorable · null {endpoint.nullValue}</small></th>)}</tr><tr>{analysis.endpoints.map((endpoint) => <FragmentHeaders key={endpoint.id} />)}</tr></thead><tbody>
            {analysis.interventions.map((intervention, interventionIndex) => <tr key={intervention.id}><th className="sticky-name"><span className="id-chip">{intervention.id}</span>{intervention.name}</th>{analysis.endpoints.map((endpoint, endpointIndex) => {
              const input = intervention.values[endpointIndex] ?? blankEffect();
              const point = result.point.results[interventionIndex]?.cells[endpointIndex];
              const interval = result.interval.results[interventionIndex]?.cells[endpointIndex];
              return <td key={endpoint.id} colSpan={3} className="effect-group"><div className="effect-inputs">{(['effect', 'lci', 'uci'] as const).map((field) => <input key={field} aria-label={`${intervention.name} ${endpoint.name} ${field}`} title={field === 'effect' ? 'Effect estimate' : field === 'lci' ? 'Lower 95% limit' : 'Upper 95% limit'} placeholder={field === 'effect' ? 'Effect' : field.toUpperCase()} value={input[field]} onChange={(event) => updateEffect(interventionIndex, endpointIndex, field, event.target.value)} />)}</div><div className="cell-directions"><span className={`direction d${point?.direction ?? 'na'}`} title={point?.reason}>PE {directionLabel(point?.direction ?? null)}</span><span className={`direction d${interval?.direction ?? 'na'}`} title={interval?.reason}>CI {directionLabel(interval?.direction ?? null)}</span>{(point?.status !== 'ok' && point?.status !== 'missing') || (interval?.status !== 'ok' && interval?.status !== 'missing') ? <span className="input-warning" title={`${point?.reason ?? ''} ${interval?.reason ?? ''}`}>Check</span> : null}</div></td>;
            })}</tr>)}
          </tbody></table></div></div>
          <div className="section-actions"><button type="button" className="secondary" onClick={addIntervention} disabled={analysis.interventions.length >= 50}>+ Add intervention</button><button type="button" className="primary" onClick={() => setActiveTab('Results')}>View recalculated results →</button></div>
        </section>}

        {activeTab === 'Results' && <section>
          <div className="section-heading"><div><p className="eyebrow">03 · Inspect scores</p><h2>Results</h2><p>Raw and full-endpoint standardized scores, calculated independently under both rules.</p></div><button type="button" className="secondary" onClick={() => setActiveTab('Save & export')}>Export analysis</button></div>
          <div className="segmented" role="tablist" aria-label="Coding rule"><button type="button" className={resultRule === 'point' ? 'active' : ''} onClick={() => setResultRule('point')}>Point-estimate coding</button><button type="button" className={resultRule === 'interval' ? 'active' : ''} onClick={() => setResultRule('interval')}>95% interval-exclusion coding</button></div>
          <div className="method-note"><strong>{result[resultRule].label}</strong><span>{resultRule === 'point' ? 'Direction is determined by the effect estimate relative to the null. Intervals are not used by this rule.' : 'A nonzero code requires the entire interval to lie strictly on one side of the null. Touching the null gives 0.'}</span></div>
          <RuleSummary rule={result[resultRule]} />
          <div className="card"><RuleTable rule={result[resultRule]} onAudit={openAudit} /></div>
          <p className="footnote">* Standardized to all {analysis.endpoints.length} defined endpoints. Exact ties share a rank. Blocked rows never enter the ranking. RCA is a screening summary, not a definitive benefit–risk assessment.</p>
        </section>}

        {activeTab === 'Compare' && <section>
          <div className="section-heading"><div><p className="eyebrow">04 · Sensitivity analysis</p><h2>Coding-rule comparison</h2><p>Compare endpoint codes, standardized scores and exact ranks side by side.</p></div></div>
          <div className="card"><div className="table-scroll"><table className="compare-table"><thead><tr><th rowSpan={2}>Intervention</th>{analysis.endpoints.map((endpoint) => <th key={endpoint.id} rowSpan={2}>{endpoint.name}<small>PE / CI</small></th>)}<th colSpan={3}>Point estimate</th><th colSpan={3}>Interval exclusion</th><th rowSpan={2}>Rank change<small>CI − PE</small></th></tr><tr><th>cob*</th><th>scob*</th><th>Rank</th><th>cob*</th><th>scob*</th><th>Rank</th></tr></thead><tbody>
            {analysis.interventions.map((intervention, index) => {
              const point = result.point.results[index];
              const interval = result.interval.results[index];
              const change = point.rank !== null && interval.rank !== null ? interval.rank - point.rank : null;
              return <tr key={intervention.id}><td><strong>{intervention.name}</strong></td>{analysis.endpoints.map((endpoint, endpointIndex) => <td key={endpoint.id} className="code-pair"><span className={`direction d${point.cells[endpointIndex].direction ?? 'na'}`}>{directionLabel(point.cells[endpointIndex].direction)}</span><span className={`direction d${interval.cells[endpointIndex].direction ?? 'na'}`}>{directionLabel(interval.cells[endpointIndex].direction)}</span></td>)}<td>{formatNumber(point.scores?.cobStd)}</td><td>{formatNumber(point.scores?.scobStd)}</td><td><span className="rank-badge">{point.rank ?? '—'}</span></td><td>{formatNumber(interval.scores?.cobStd)}</td><td>{formatNumber(interval.scores?.scobStd)}</td><td><span className="rank-badge">{interval.rank ?? '—'}</span></td><td>{change === null ? '—' : change === 0 ? <span className="unchanged">0</span> : <span className={change > 0 ? 'rank-down' : 'rank-up'}>{change > 0 ? `+${change}` : change}</span>}</td></tr>;
            })}
          </tbody></table></div></div>
          <div className="explanation-grid"><div className="mini-card"><h3>Reading rank change</h3><p>A positive value means a worse (larger) rank under interval coding. Changes often reflect ties separating or collapsing, not necessarily strict order reversals.</p></div><div className="mini-card"><h3>Why zeros matter</h3><p>Interval zeros indicate neutral or uncertain evidence. An all-zero profile can precede profiles with unfavorable directions; zero does not establish equivalence.</p></div></div>
        </section>}

        {activeTab === 'Audit' && selectedAudit && <section>
          <div className="section-heading"><div><p className="eyebrow">05 · Reproduce every step</p><h2>Calculation audit</h2><p>Follow raw inputs through coding, pair contributions, standardization and rank.</p></div></div>
          <div className="audit-controls card"><label className="field"><span>Intervention</span><select value={selectedAudit.id} onChange={(event) => setAuditId(event.target.value)}>{analysis.interventions.map((intervention) => <option key={intervention.id} value={intervention.id}>{intervention.name}</option>)}</select></label><div className="segmented"><button type="button" className={auditRule === 'point' ? 'active' : ''} onClick={() => setAuditRule('point')}>Point estimate</button><button type="button" className={auditRule === 'interval' ? 'active' : ''} onClick={() => setAuditRule('interval')}>Interval exclusion</button></div><div className={`audit-status ${selectedAudit.status === 'Ready' ? 'ready' : 'blocked'}`}><strong>{selectedAudit.status}</strong><span>{selectedAudit.statusReason}</span></div></div>
          <div className="metric-grid"><div><span>Observed endpoints</span><strong>k = {selectedAudit.k}</strong><small>n = {analysis.endpoints.length}</small></div><div><span>Observed pairs</span><strong>M = {selectedAudit.pairs}</strong><small>C(n, 2) = {analysis.endpoints.length * (analysis.endpoints.length - 1) / 2}</small></div><div><span>RCA_cob*</span><strong>{formatNumber(selectedAudit.scores?.cobStd)}</strong><small>Primary sorting key</small></div><div><span>Final rank</span><strong>{selectedAudit.rank ?? '—'}</strong><small>Exact ties retained</small></div></div>
          <div className="card"><div className="card-heading"><div><h3>1 · Endpoint coding</h3><p>Missing values remain blank and do not enter k or any pair.</p></div></div><div className="table-scroll"><table><thead><tr><th>Endpoint</th><th>Effect</th><th>LCI</th><th>UCI</th><th>Direction</th><th>Status</th><th>Reason</th></tr></thead><tbody>{selectedAudit.cells.map((cell, index) => <tr key={cell.endpointId}><td><strong>{analysis.endpoints[index].name}</strong></td><td>{selectedInput?.values[index]?.effect || '—'}</td><td>{selectedInput?.values[index]?.lci || '—'}</td><td>{selectedInput?.values[index]?.uci || '—'}</td><td><span className={`direction d${cell.direction ?? 'na'}`}>{directionLabel(cell.direction)}</span></td><td>{cell.status}</td><td className="reason-cell">{cell.reason}</td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="card-heading"><div><h3>2 · Pairwise contributions</h3><p>Each weight is wᵢwⱼ. SCOB = COB − unfavorable-pair penalties.</p></div></div>{selectedAudit.pairContributions.length ? <div className="table-scroll"><table><thead><tr><th>Endpoint pair</th><th>Directions</th><th>Category</th><th>Weight</th><th>COB</th><th>Penalty</th><th>SCOB</th></tr></thead><tbody>{selectedAudit.pairContributions.map((pair) => <tr key={`${pair.leftEndpointId}-${pair.rightEndpointId}`}><td>{pair.leftName} × {pair.rightName}</td><td>{directionLabel(pair.leftDirection)} / {directionLabel(pair.rightDirection)}</td><td><span className="id-chip">{pair.category}</span></td><td>{formatNumber(pair.weight)}</td><td>{formatNumber(pair.cob)}</td><td>{formatNumber(pair.penalty)}</td><td>{formatNumber(pair.scob)}</td></tr>)}</tbody></table></div> : <p className="empty-state">Fewer than two observed endpoints: no pairs are available.</p>}</div>
          <div className="card"><h3>3 · Totals and standardization</h3><div className="formula-list"><div><code>RCA_lite = {formatNumber(selectedAudit.scores?.lite)}</code><span>{formatNumber(selectedAudit.scores?.lite)} × (W / St) = {formatNumber(selectedAudit.scores?.lite)} × ({formatNumber(selectedAudit.totalWeight)} / {formatNumber(selectedAudit.observedWeight)}) = <strong>{formatNumber(selectedAudit.scores?.liteStd)}</strong></span></div><div><code>RCA_cob = {formatNumber(selectedAudit.scores?.cob)}</code><span>{formatNumber(selectedAudit.scores?.cob)} × (T / Tt) = {formatNumber(selectedAudit.scores?.cob)} × ({formatNumber(selectedAudit.totalPairWeight)} / {formatNumber(selectedAudit.observedPairWeight)}) = <strong>{formatNumber(selectedAudit.scores?.cobStd)}</strong></span></div><div><code>RCA_scob = {formatNumber(selectedAudit.scores?.scob)}</code><span>{formatNumber(selectedAudit.scores?.scob)} × (T / Tt) = {formatNumber(selectedAudit.scores?.scob)} × ({formatNumber(selectedAudit.totalPairWeight)} / {formatNumber(selectedAudit.observedPairWeight)}) = <strong>{formatNumber(selectedAudit.scores?.scobStd)}</strong></span></div></div>{selectedAudit.status !== 'Ready' && <p className="validation-text">Scores and standardized values are blocked because this intervention is not eligible.</p>}<p className="footnote">Rank = 1 + number of eligible interventions with a greater cob*, or equal cob* and greater scob*, or equal cob* and scob* and greater lite*. No name-based tie breaking is applied.</p></div>
        </section>}

        {activeTab === 'Save & export' && <section>
          <div className="section-heading"><div><p className="eyebrow">06 · Preserve and share</p><h2>Save & export</h2><p>Reproducibility packages contain complete raw inputs, parameters, audit trails and software versions.</p></div></div>
          <div className="export-grid">
            <div className="card"><h3>Reproducibility package</h3><p>JSON restores the complete analysis. Excel includes inputs, both result sets, coding reasons and every pair contribution.</p><div className="button-stack"><button type="button" className="primary" onClick={() => void exportJson()}>Export complete JSON</button><button type="button" className="secondary" onClick={() => void exportExcel()}>Export results & audit Excel</button><button type="button" className="ghost" onClick={() => jsonInput.current?.click()}>Reload analysis JSON</button><input ref={jsonInput} className="sr-only" type="file" accept=".json" aria-label="Reload analysis JSON file" onChange={(event) => void onJsonFile(event.target.files?.[0])} /></div><div className="digest"><span>Canonical input SHA-256</span><code>{digest}</code><small>Array order is preserved; object keys are recursively sorted before hashing.</small></div></div>
            <div className="card"><h3>Browser storage</h3><p>Saved analyses stay in this browser on this device. No data is transmitted.</p><div className="save-row"><input aria-label="Saved analysis name" value={saveName} onChange={(event) => setSaveName(event.target.value)} /><button type="button" className="primary" onClick={() => { try { saveAnalysis(saveName, analysis); setSaved(listSavedAnalyses()); setNotice({ type: 'success', text: `Saved “${saveName}” in this browser.` }); } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Save failed.' }); } }}>Save / overwrite</button></div><div className="saved-list">{saved.length ? saved.map((item) => <div key={item.name}><div><strong>{item.name}</strong><small>{new Date(item.savedAt).toLocaleString()}</small></div><button type="button" className="link-button" onClick={() => { try { replaceAnalysis(loadAnalysis(item.name), `Reloaded “${item.name}”.`); } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Load failed.' }); } }}>Load</button><button type="button" className="link-button danger" onClick={() => { deleteAnalysis(item.name); setSaved(listSavedAnalyses()); }}>Delete</button></div>) : <p className="empty-state">No saved analyses yet.</p>}</div></div>
          </div>
          <div className="version-panel"><div><span>Application</span><strong>{APP_VERSION}</strong></div><div><span>Calculation engine</span><strong>{ENGINE_VERSION}</strong></div><div><span>Analysis schema</span><strong>{SCHEMA_VERSION}</strong></div><div><span>Runtime</span><strong>Browser · local JavaScript</strong></div></div>
        </section>}

        {activeTab === 'Method' && <section>
          <div className="section-heading"><div><p className="eyebrow">Reference & provenance</p><h2>Method and rules</h2><p>Implementation follows the latest revised manuscript and revised Supporting Information S1/S2.</p></div></div>
          <div className="method-layout"><div className="card method-copy"><h3>Direction coding</h3><p>Each observed intervention–endpoint effect is coded +1 favorable, 0 neutral or uncertain, or −1 unfavorable. Missing endpoints are excluded and never converted to 0.</p><ul><li><strong>Point estimate:</strong> compare the effect with the endpoint null. Equality gives 0.</li><li><strong>95% interval:</strong> require LCI ≤ effect ≤ UCI. A nonzero code requires strict exclusion of the null; inclusion or touching gives 0.</li><li><strong>Coverage:</strong> k ≥ m ≥ 2. Otherwise scores and rank are blocked.</li></ul><h3>Three scores</h3><div className="equation">RCA_lite = Σ wᵢdᵢ</div><div className="equation">RCA_cob = N<sub>++</sub> − N<sub>−−</sub></div><div className="equation">RCA_scob = RCA_cob − N<sub>+/−</sub> − N<sub>0/−</sub></div><p>Pair counts and contributions are weighted by wᵢwⱼ when weights are enabled. Raw scores use observed endpoints only.</p><h3>Standardization and sorting</h3><p>lite* = lite × W/St. cob* and scob* use T/Tt, where W and T describe all defined endpoints and St and Tt describe observed endpoints. Both observed denominators must be positive.</p><p>Sort descending by <strong>cob*, then scob*, then lite*</strong>. Exact ties share a competition rank; source row order is used only for stable display.</p></div>
            <aside><div className="mini-card"><h3>Source documents</h3><p><code>返修/revised_manuscript .docx</code><br />30 October 2026</p><p><code>revised_Supporting_Information_S1/S2</code><br />28 October 2026</p><p>Published example data and expected results come from revised Supporting Information S3.</p></div><div className="mini-card conflict"><h3>Recorded version conflict</h3><p>The older GitHub README and Excel tools treat negative weights as 0. The latest revised manuscript and revised Excel tools declare negative or non-numeric weights invalid.</p><p><strong>This website follows the latest revision:</strong> negative weights block scoring, even when weighting is switched off, matching the revised setup validation.</p></div><div className="mini-card"><h3>Scope and limitations</h3><p>Only statistical-null coding is implemented; separate clinical thresholds are not. RCA discards effect magnitude and interval width, does not model cross-outcome uncertainty or correlation, and cannot restore missing evidence through standardization.</p></div></aside>
          </div>
        </section>}
      </main>
      <footer><span>RCA Score Calculator · Reproducible local computation</span><span>Local processing · No data upload</span></footer>
    </div>
  );
}

function FragmentHeaders() {
  return <><th>Effect</th><th>LCI</th><th>UCI</th></>;
}

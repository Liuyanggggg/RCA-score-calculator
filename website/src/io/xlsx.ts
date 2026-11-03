import { strToU8, unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { WorkbookSheet } from '../engine/types.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false });
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_XML_BYTES = 50 * 1024 * 1024;

type XmlNode = Record<string, unknown>;

function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function parseXml(bytes: Uint8Array): XmlNode {
  if (bytes.length > MAX_XML_BYTES) throw new Error('An XML part in this workbook is too large.');
  return parser.parse(decoder.decode(bytes)) as XmlNode;
}

function textContent(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  const record = node as XmlNode;
  if (record['#text'] != null) return textContent(record['#text']);
  if (record.t != null) return textContent(record.t);
  if (record.r != null) return array(record.r).map(textContent).join('');
  return '';
}

function columnIndex(reference: string): number {
  const match = reference.match(/^([A-Z]+)/i);
  if (!match) return 0;
  return [...match[1].toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function resolvePart(target: string): string {
  const normalized = target.replace(/^\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized.replace(/^\.\//, '')}`;
}

export function readWorkbook(input: ArrayBuffer | Uint8Array): WorkbookSheet[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Workbook exceeds the 15 MB import limit.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not a valid .xlsx ZIP workbook. Legacy .xls files are not supported.');
  }
  if (!files['xl/workbook.xml']) throw new Error('Workbook has no xl/workbook.xml.');
  const workbook = parseXml(files['xl/workbook.xml']);
  const relationships = files['xl/_rels/workbook.xml.rels'] ? parseXml(files['xl/_rels/workbook.xml.rels']) : {};
  const relationNodes = array((relationships.Relationships as XmlNode | undefined)?.Relationship);
  const targets = new Map<string, string>();
  for (const relation of relationNodes) {
    const node = relation as XmlNode;
    targets.set(String(node['@_Id']), String(node['@_Target']));
  }
  const sharedStrings: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const shared = parseXml(files['xl/sharedStrings.xml']);
    for (const item of array((shared.sst as XmlNode | undefined)?.si)) sharedStrings.push(textContent(item));
  }
  const sheets = array((workbook.workbook as XmlNode | undefined)?.sheets ? ((workbook.workbook as XmlNode).sheets as XmlNode).sheet : undefined);
  return sheets.map((sheetNode) => {
    const sheet = sheetNode as XmlNode;
    const name = String(sheet['@_name']);
    const relationId = String(sheet['@_id']);
    const target = targets.get(relationId);
    if (!target) throw new Error(`Worksheet ${name} has no resolvable relationship.`);
    const part = resolvePart(target);
    if (!files[part]) throw new Error(`Worksheet part is missing: ${part}`);
    const xml = parseXml(files[part]);
    const rowNodes = array(((xml.worksheet as XmlNode).sheetData as XmlNode | undefined)?.row);
    const rows: Array<Array<string | number | null>> = [];
    for (const rowNode of rowNodes) {
      const row = rowNode as XmlNode;
      const rowNumber = Number(row['@_r'] ?? rows.length + 1);
      if (rowNumber > 10000) throw new Error('Worksheet exceeds the 10,000-row import limit.');
      const values: Array<string | number | null> = [];
      for (const cellNode of array(row.c)) {
        const cell = cellNode as XmlNode;
        const index = columnIndex(String(cell['@_r'] ?? ''));
        if (index > 500) throw new Error('Worksheet exceeds the 500-column import limit.');
        const type = String(cell['@_t'] ?? 'n');
        let value: string | number | null = null;
        if (type === 'inlineStr') value = textContent(cell.is);
        else if (type === 's') value = sharedStrings[Number(cell.v)] ?? '';
        else if (type === 'b') value = String(cell.v) === '1' ? 'TRUE' : 'FALSE';
        else if (cell.v != null) value = textContent(cell.v);
        values[index] = value;
      }
      rows[rowNumber - 1] = values.map((value) => value ?? null);
    }
    return { name, rows: rows.map((row) => row ?? []) };
  });
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let output = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function sheetXml(sheet: WorkbookSheet): string {
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.flatMap((value, columnIndex) => {
      if (value === null || value === '') return [];
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return [`<c r="${reference}"><v>${value}</v></c>`];
      return [`<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`];
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function writeWorkbook(sheets: WorkbookSheet[]): Uint8Array {
  if (!sheets.length || sheets.length > 100) throw new Error('Workbook must contain between 1 and 100 worksheets.');
  const names = sheets.map((sheet) => sheet.name);
  if (new Set(names).size !== names.length) throw new Error('Worksheet names must be unique.');
  for (const name of names) if (!name || name.length > 31 || /[\\/*?:[\]]/.test(name)) throw new Error(`Invalid worksheet name: ${name}`);
  const files: Record<string, Uint8Array> = {};
  const contentOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${contentOverrides}</Types>`);
  files['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  files['docProps/core.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>RCA Score Calculator</dc:creator><cp:lastModifiedBy>RCA Score Calculator</cp:lastModifiedBy></cp:coreProperties>');
  files['docProps/app.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>RCA Score Calculator</Application></Properties>');
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>');
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = encoder.encode(sheetXml(sheet)); });
  const zipped: Parameters<typeof zipSync>[0] = {};
  for (const [name, data] of Object.entries(files)) zipped[name] = [data, { mtime: new Date('1980-01-01T00:00:00Z') }];
  return zipSync(zipped, { level: 6 });
}

/**
 * 봉투 안 파일 가명/익명화 적용.
 *
 * 카테고리:
 *   A. inline 직접 교체 — txt/md/csv/json/xml/...  · xlsx/xls · pptx · hwpx
 *   B. inline 직접 교체 (OOXML) — docx
 *   C. sidecar 동봉 — pdf · 이미지 · hwp · 기타 미지원
 *
 * 결과:
 *   - inline: file.data 가 가명화된 내용으로 교체
 *   - sidecar: 원본 파일 + "{name}.anonymized.txt" 추가 파일 동봉
 *   - unsupported: 메타에 사유 명시. 사용자에게 안내 (다른 포맷 권장).
 */
import type { FileEntry } from '../compression/compressor';
import type { Replacement } from './types';

export type AnonymizeMethod = 'inline' | 'sidecar' | 'unsupported';

export interface FileAnonymizationReport {
  filename: string;
  method: AnonymizeMethod;
  /** sidecar 인 경우 동봉된 파일명 */
  sidecarFilename?: string;
  /** 사용자에게 보여줄 안내 (한국어) */
  note?: string;
  /** 적용 가능한 변환 제안 (HWP → HWPX 등) */
  suggestion?: string;
}

export interface AnonymizeFilesResult {
  files: FileEntry[];
  reports: FileAnonymizationReport[];
}

const TEXT_EXTENSIONS = /^(txt|md|csv|json|xml|html?|log|yaml|yml|tsv)$/i;

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** PII original → replacement 쌍을 문자열에 일괄 적용. 긴 것 먼저 (부분 매칭 방지). */
function applyMapping(input: string, reps: Replacement[]): { out: string; changed: number } {
  if (!input || reps.length === 0) return { out: input, changed: 0 };
  const sorted = [...reps]
    .filter(r => r.original && r.original.length > 0)
    .sort((a, b) => b.original.length - a.original.length);
  let out = input;
  let changed = 0;
  for (const r of sorted) {
    if (out.includes(r.original)) {
      const before = out;
      out = out.split(r.original).join(r.replacement);
      if (before !== out) changed += 1;
    }
  }
  return { out, changed };
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 텍스트 디코딩 — UTF-8 우선, 한국어 폴백. */
function decodeText(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch { /* fall through */ }
  for (const enc of ['euc-kr', 'cp949', 'windows-949']) {
    try { return new TextDecoder(enc).decode(data); } catch { /* skip */ }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

// ─────────────────────────────────────────────
// 카테고리 A — 평문 텍스트
// ─────────────────────────────────────────────
function anonymizePlainText(file: FileEntry, reps: Replacement[]): { file: FileEntry; report: FileAnonymizationReport } {
  const text = decodeText(file.data);
  const { out, changed } = applyMapping(text, reps);
  const newData = new TextEncoder().encode(out);
  return {
    file: { ...file, data: newData, size: newData.byteLength },
    report: {
      filename: file.name,
      method: 'inline',
      note: changed > 0 ? `${changed}개 PII 항목이 직접 교체됨 (UTF-8 으로 인코딩)` : '교체 대상 없음',
    },
  };
}

// ─────────────────────────────────────────────
// 카테고리 A — XLSX/XLS
// ─────────────────────────────────────────────
async function anonymizeXlsx(file: FileEntry, reps: Replacement[]): Promise<{ file: FileEntry; report: FileAnonymizationReport }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(file.data, { type: 'array' });
  let changed = 0;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    for (const addr of Object.keys(sheet)) {
      if (addr.startsWith('!')) continue;
      const cell = (sheet as any)[addr];
      if (!cell || cell.t !== 's' || typeof cell.v !== 'string') continue;
      const { out, changed: c } = applyMapping(cell.v, reps);
      if (c > 0) {
        cell.v = out;
        delete cell.w; // formatted cache 제거
        delete cell.h; // html cache 제거
        changed += c;
      }
    }
  }
  const newData = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return {
    file: { ...file, data: newData, size: newData.byteLength, name: file.name.replace(/\.xls$/i, '.xlsx') },
    report: {
      filename: file.name,
      method: 'inline',
      note: changed > 0 ? `${changed}개 셀의 PII 텍스트가 교체됨` : '셀 내 교체 대상 없음',
      suggestion: file.name.toLowerCase().endsWith('.xls') ? '구 BIFF (.xls) 는 .xlsx 로 자동 저장됨' : undefined,
    },
  };
}

// ─────────────────────────────────────────────
// 카테고리 A — OOXML 계열 (PPTX / HWPX / DOCX) ZIP + XML 텍스트 노드 교체
// ─────────────────────────────────────────────
async function anonymizeOoxmlZip(
  file: FileEntry, reps: Replacement[],
  textTagPattern: RegExp,
  filePathFilter: (path: string) => boolean,
): Promise<{ data: Uint8Array; changed: number }> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const files = unzipSync(file.data);
  const updated: Record<string, Uint8Array> = {};
  let changed = 0;
  for (const path of Object.keys(files)) {
    const data = files[path]!;
    if (!filePathFilter(path)) {
      updated[path] = data;
      continue;
    }
    let xml = strFromU8(data);
    xml = xml.replace(textTagPattern, (full, openTag: string, content: string, closeTag: string) => {
      const decoded = unescapeXml(content);
      const { out, changed: c } = applyMapping(decoded, reps);
      if (c === 0) return full;
      changed += c;
      return `${openTag}${escapeXml(out)}${closeTag}`;
    });
    updated[path] = strToU8(xml);
  }
  return { data: zipSync(updated), changed };
}

async function anonymizePptx(file: FileEntry, reps: Replacement[]) {
  // <a:t>text</a:t>
  const tagPattern = /(<a:t[^>]*>)([^<]*)(<\/a:t>)/g;
  const filter = (p: string) => /^ppt\/slides\/slide\d+\.xml$/i.test(p)
    || /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(p);
  const { data, changed } = await anonymizeOoxmlZip(file, reps, tagPattern, filter);
  return {
    file: { ...file, data, size: data.byteLength },
    report: {
      filename: file.name,
      method: 'inline' as const,
      note: changed > 0 ? `${changed}개 슬라이드 텍스트 노드 교체됨` : '슬라이드 내 교체 대상 없음',
    },
  };
}

async function anonymizeHwpx(file: FileEntry, reps: Replacement[]) {
  // <hp:t> 또는 <hp:char>
  const tagPattern = /(<hp:(?:t|char)[^>]*>)([^<]*)(<\/hp:(?:t|char)>)/g;
  const filter = (p: string) => /^Contents\/section\d+\.xml$/i.test(p);
  const { data, changed } = await anonymizeOoxmlZip(file, reps, tagPattern, filter);
  return {
    file: { ...file, data, size: data.byteLength },
    report: {
      filename: file.name,
      method: 'inline' as const,
      note: changed > 0 ? `${changed}개 HWPX section 텍스트 교체됨` : 'section 내 교체 대상 없음',
    },
  };
}

async function anonymizeDocx(file: FileEntry, reps: Replacement[]) {
  // <w:t>text</w:t> — 단, w:preserve 등 attr 이 붙을 수 있어 그대로 보존
  const tagPattern = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
  const filter = (p: string) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(p);
  const { data, changed } = await anonymizeOoxmlZip(file, reps, tagPattern, filter);
  return {
    file: { ...file, data, size: data.byteLength },
    report: {
      filename: file.name,
      method: 'inline' as const,
      note: changed > 0 ? `${changed}개 DOCX 텍스트 노드 교체됨` : '문서 내 교체 대상 없음',
    },
  };
}

// ─────────────────────────────────────────────
// 카테고리 C — sidecar 동봉
// ─────────────────────────────────────────────
function buildSidecar(file: FileEntry, anonymizedText: string, reasonNote: string, suggestion?: string): { files: FileEntry[]; report: FileAnonymizationReport } {
  const sidecarName = `${file.name}.anonymized.txt`;
  const sidecarData = new TextEncoder().encode(anonymizedText);
  const sidecar: FileEntry = {
    name: sidecarName,
    data: sidecarData,
    size: sidecarData.byteLength,
    lastModified: Date.now(),
    type: 'text/plain',
  };
  return {
    files: [file, sidecar],
    report: {
      filename: file.name,
      method: 'sidecar',
      sidecarFilename: sidecarName,
      note: reasonNote,
      suggestion,
    },
  };
}

// ─────────────────────────────────────────────
// 카테고리 D — 미지원 (텍스트 추출 자체가 안 된 경우)
// ─────────────────────────────────────────────
function buildUnsupported(file: FileEntry, reasonNote: string, suggestion?: string): FileAnonymizationReport {
  return {
    filename: file.name,
    method: 'unsupported',
    note: reasonNote,
    suggestion,
  };
}

// ─────────────────────────────────────────────
// 메인 dispatch
// ─────────────────────────────────────────────

export interface PerFileExtract {
  filename: string;
  text: string;
  source: string;
  warnings?: string[];
}

/**
 * 파일 배열에 가명/익명화 적용.
 * @param files          입력 파일들 (원본)
 * @param replacements   AnonymizationResult.replacements
 * @param perFileExtract 각 파일의 추출 결과 (sidecar 모드에서 가명화된 텍스트 생성용)
 */
export async function anonymizeAllFiles(
  files: FileEntry[],
  replacements: Replacement[],
  perFileExtract: PerFileExtract[],
): Promise<AnonymizeFilesResult> {
  const out: FileEntry[] = [];
  const reports: FileAnonymizationReport[] = [];

  for (const file of files) {
    const e = ext(file.name);
    const extractInfo = perFileExtract.find(p => p.filename === file.name);

    try {
      if (TEXT_EXTENSIONS.test(e)) {
        const r = anonymizePlainText(file, replacements);
        out.push(r.file); reports.push(r.report);
      } else if (e === 'xlsx' || e === 'xls') {
        const r = await anonymizeXlsx(file, replacements);
        out.push(r.file); reports.push(r.report);
      } else if (e === 'pptx') {
        const r = await anonymizePptx(file, replacements);
        out.push(r.file); reports.push(r.report);
      } else if (e === 'hwpx') {
        const r = await anonymizeHwpx(file, replacements);
        out.push(r.file); reports.push(r.report);
      } else if (e === 'docx') {
        const r = await anonymizeDocx(file, replacements);
        out.push(r.file); reports.push(r.report);
      } else if (e === 'pdf') {
        // PDF — 레이아웃 보존 어려움. 추출된 텍스트 가명화 후 동봉.
        const original = extractInfo?.text || '';
        const { out: anonText } = applyMapping(original, replacements);
        const r = buildSidecar(file, anonText,
          'PDF 는 레이아웃 보존 문제로 직접 교체 불가 — 가명화된 텍스트를 별도 파일로 동봉.',
          '편집 가능한 원본 (DOCX/XLSX/PPTX/HWPX) 으로 변환 후 다시 봉투 만들기 권장.');
        out.push(...r.files); reports.push(r.report);
      } else if (e === 'hwp') {
        // HWP 바이너리 — 재구성 불가. HWPX 변환 권장.
        const original = extractInfo?.text || '';
        const { out: anonText } = applyMapping(original, replacements);
        const r = buildSidecar(file, anonText,
          'HWP 바이너리 (한컴 구버전) 는 직접 교체 불가 — 가명화된 텍스트를 동봉.',
          'HWPX (한컴 2014+ 신 포맷) 로 저장하시면 가명화가 직접 적용됩니다.');
        out.push(...r.files); reports.push(r.report);
      } else if (extractInfo?.source === 'ocr' || /^(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(e)) {
        // 이미지 — OCR 결과 가명화 후 동봉. 원본 이미지 보존.
        const original = extractInfo?.text || '';
        const { out: anonText } = applyMapping(original, replacements);
        const r = buildSidecar(file, anonText,
          '이미지 파일은 픽셀 위 텍스트 교체 불가 — OCR 결과를 가명화하여 별도 동봉.',
          '편집 가능한 원본 문서 (DOCX/HWPX 등) 가 있다면 그것을 봉투로 만드는 것이 정확합니다.');
        out.push(...r.files); reports.push(r.report);
      } else {
        // 미지원 포맷 — 원본 그대로 유지하지만 보고
        out.push(file);
        reports.push(buildUnsupported(file,
          `미지원 포맷 (.${e || 'unknown'}) — 자동 가명화 적용 불가. 원본 그대로 봉투에 들어감.`,
          '평문 텍스트 (TXT/CSV) 또는 OOXML (DOCX/XLSX/PPTX/HWPX) 로 변환 후 다시 시도하세요.'));
      }
    } catch (err) {
      // 처리 중 예외 → 원본 유지 + 사유 보고
      out.push(file);
      reports.push({
        filename: file.name,
        method: 'unsupported',
        note: `처리 중 오류: ${(err as Error).message}`,
        suggestion: '다른 포맷으로 변환 후 다시 시도하거나, 가명화 없이 봉투를 만드세요.',
      });
    }
  }

  return { files: out, reports };
}

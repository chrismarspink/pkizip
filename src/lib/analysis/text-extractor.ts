/**
 * 다중 포맷 텍스트 추출 — PDF / DOCX / XLSX / PPTX / HWP / HWPX / 이미지(OCR) / 일반 텍스트
 *
 * 모든 라이브러리는 **lazy import** — 초기 번들 크기 영향 0.
 * 사용된 포맷에 해당하는 모듈만 그때그때 가져옴.
 *
 * 한국어 환경 고려:
 *   - cp949 / euc-kr 인코딩 폴백
 *   - HWP 바이너리: hwp.js 시도, 실패 시 OLE 헤더만 검사
 *   - HWPX: ZIP + XML 직접 파싱 (fflate)
 */
import { unzipSync, strFromU8 } from 'fflate';

export interface ExtractInput {
  name: string;
  type?: string;
  data: Uint8Array;
}

export interface ExtractResult {
  text: string;
  /** 어떤 추출 경로를 탔는지 — UI / 메타에 표시 */
  source: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'hwp' | 'hwpx' | 'ocr' | 'binary' | 'unsupported';
  pages?: number;
  ocrApplied?: boolean;
  ocrConfidence?: number;
  ocrLanguages?: string[];
  warnings?: string[];
}

// ─────────────────────────────────────────────
// 포맷 판별
// ─────────────────────────────────────────────

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function isImage(input: ExtractInput): boolean {
  if (input.type?.startsWith('image/')) return true;
  return /^(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(ext(input.name));
}

function isPlainText(input: ExtractInput): boolean {
  const e = ext(input.name);
  if (/^(txt|md|csv|json|xml|html?|log|yaml|yml|tsv)$/i.test(e)) return true;
  return !!input.type && /^(text\/|application\/(json|xml|x-yaml|yaml))/.test(input.type);
}

function isHwpx(data: Uint8Array): boolean {
  // HWPX는 ZIP — `PK\x03\x04` magic + mimetype 안에 'application/hwp+zip'
  if (data.length < 4) return false;
  if (data[0] !== 0x50 || data[1] !== 0x4B || data[2] !== 0x03 || data[3] !== 0x04) return false;
  // 검증은 unzip 해서 mimetype 확인 (extractHwpx 에서)
  return true;
}

function isHwpBinary(data: Uint8Array): boolean {
  // OLE2 Compound Document magic: D0 CF 11 E0 A1 B1 1A E1
  if (data.length < 8) return false;
  return data[0] === 0xD0 && data[1] === 0xCF && data[2] === 0x11 && data[3] === 0xE0;
}

// ─────────────────────────────────────────────
// 텍스트 디코딩 — UTF-8 → cp949/euc-kr 폴백
// ─────────────────────────────────────────────

function decodeText(data: Uint8Array): string {
  // BOM 처리
  if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }
  if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  }
  if (data.length >= 2 && data[0] === 0xFE && data[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  }
  // UTF-8 fatal → 실패 시 cp949
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch { /* fall through */ }
  // 한국어 환경 폴백
  for (const enc of ['euc-kr', 'cp949', 'windows-949']) {
    try { return new TextDecoder(enc).decode(data); } catch { /* skip */ }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

// ─────────────────────────────────────────────
// PDF — pdfjs-dist
// ─────────────────────────────────────────────

async function extractPdf(input: ExtractInput): Promise<ExtractResult> {
  const pdfjsLib: any = await import('pdfjs-dist');
  // worker 설정 — `import.meta.url` 패턴이 Vite + 모던 브라우저에서 가장 안정적.
  // `?url` import 는 Vite 환경별로 동작 차이가 있어 회피.
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      // 1) ?url 시도 (Vite/번들러 친화) — string 인지 확인 후 적용
      const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      const url = (mod as any).default;
      if (typeof url === 'string') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = url;
      } else {
        throw new Error('not a string');
      }
    } catch {
      // 2) CDN fallback — pkg 버전과 일치
      const v = (pdfjsLib as any).version || '5.7.284';
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
    }
  }

  // ArrayBuffer 복사 (slice) — pdfjs 가 transferable 로 가져가는 걸 방지
  const buf = input.data.slice(0).buffer as ArrayBuffer;
  const loadingTask = pdfjsLib.getDocument({
    data: buf,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // pdfjs 5.x: content.items[*] 는 TextItem | TextMarkedContent
    const text = content.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ');
    pages.push(text);
  }
  const fullText = pages.join('\n\n').trim();
  const warnings: string[] = [];
  if (!fullText) {
    warnings.push('PDF 텍스트 추출 결과 비어있음 — 스캔 PDF 가능성. 이미지로 변환 후 OCR 권장.');
  }
  return { text: fullText, source: 'pdf', pages: pdf.numPages, warnings };
}

// ─────────────────────────────────────────────
// DOCX — mammoth
// ─────────────────────────────────────────────

async function extractDocx(input: ExtractInput): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({
    arrayBuffer: input.data.slice(0).buffer as ArrayBuffer,
  });
  const warnings = (result.messages || [])
    .filter(m => m.type !== 'info')
    .map(m => m.message);
  return { text: result.value || '', source: 'docx', warnings };
}

// ─────────────────────────────────────────────
// XLSX / XLS — SheetJS
// ─────────────────────────────────────────────

async function extractXlsx(input: ExtractInput): Promise<ExtractResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(input.data, { type: 'array' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    parts.push(`# ${sheetName}`);
    parts.push(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }));
  }
  return { text: parts.join('\n\n'), source: 'xlsx' };
}

// ─────────────────────────────────────────────
// PPTX — XML 직접 파싱 (fflate 기존)
// ─────────────────────────────────────────────

async function extractPptx(input: ExtractInput): Promise<ExtractResult> {
  const files = unzipSync(input.data);
  const slides = Object.keys(files)
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const ai = parseInt(a.match(/(\d+)\.xml$/)?.[1] || '0');
      const bi = parseInt(b.match(/(\d+)\.xml$/)?.[1] || '0');
      return ai - bi;
    });
  const parts: string[] = [];
  for (const k of slides) {
    const xml = strFromU8(files[k]!);
    // <a:t> ... </a:t> 태그 안 텍스트만 추출
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const slideText = matches.map(m => {
      const inner = /<a:t[^>]*>([^<]*)<\/a:t>/.exec(m);
      return inner ? unescapeXml(inner[1] || '') : '';
    }).join(' ');
    if (slideText.trim()) parts.push(slideText.trim());
  }
  return { text: parts.join('\n\n'), source: 'pptx', pages: slides.length };
}

// ─────────────────────────────────────────────
// HWPX — ZIP + Contents/section*.xml
// ─────────────────────────────────────────────

async function extractHwpx(input: ExtractInput): Promise<ExtractResult> {
  const files = unzipSync(input.data);
  // mimetype 검증
  const mimeData = files['mimetype'];
  if (mimeData) {
    const mime = strFromU8(mimeData).trim();
    if (!/hwp/i.test(mime)) {
      return { text: '', source: 'unsupported', warnings: [`HWPX mimetype 불일치: ${mime}`] };
    }
  }
  const sections = Object.keys(files)
    .filter(k => /^Contents\/section\d+\.xml$/i.test(k))
    .sort();
  const parts: string[] = [];
  for (const k of sections) {
    const xml = strFromU8(files[k]!);
    // <hp:t> 또는 <hp:char> 태그 안 텍스트
    const matches = xml.match(/<hp:t[^>]*>([^<]*)<\/hp:t>|<hp:char[^>]*>([^<]*)<\/hp:char>/g) || [];
    const sectionText = matches.map(m => {
      const inner = /<hp:[^>]+>([^<]*)<\/hp:[^>]+>/.exec(m);
      return inner ? unescapeXml(inner[1] || '') : '';
    }).join(' ');
    if (sectionText.trim()) parts.push(sectionText.trim());
  }
  return {
    text: parts.join('\n\n'),
    source: 'hwpx',
    pages: sections.length,
    warnings: parts.length === 0 ? ['HWPX section 텍스트 추출 결과 비어있음'] : undefined,
  };
}

// ─────────────────────────────────────────────
// HWP (바이너리 OLE2) — hwp.js 시도, 실패 시 fallback
// ─────────────────────────────────────────────

async function extractHwp(input: ExtractInput): Promise<ExtractResult> {
  try {
    const hwp: any = await import('hwp.js');
    const parser = hwp.parse || hwp.default?.parse || hwp.default;
    if (typeof parser !== 'function') {
      return fallbackHwp(input, 'hwp.js parse() 함수 없음');
    }
    // hwp.js 내부의 cfb.read 는 input 타입을 명시해야 함 — Uint8Array 면 'array'
    // 명시 안 하면 string 으로 추론하여 input.replace 호출 → TypeError
    let parsed: any;
    try {
      parsed = parser(input.data, { type: 'array' });
    } catch {
      // 일부 버전은 옵션 시그니처가 달라 — Buffer-like 객체로 재시도
      const buf: any = input.data;
      buf.toString = function (encoding?: string) {
        if (encoding === 'binary') {
          let s = '';
          for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i]);
          return s;
        }
        return Uint8Array.prototype.toString.call(this);
      };
      parsed = parser(buf, { type: 'buffer' });
    }
    const text = collectHwpText(parsed);
    return {
      text,
      source: 'hwp',
      warnings: text.length === 0 ? ['HWP 바이너리 추출 결과 비어있음'] : undefined,
    };
  } catch (e) {
    return fallbackHwp(input, `hwp.js 실패: ${(e as Error).message}`);
  }
}

function collectHwpText(parsed: any): string {
  // hwp.js 출력 구조가 버전별로 다양 — 다양한 키 시도
  if (!parsed) return '';
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed.map(collectHwpText).join('\n');
  if (typeof parsed === 'object') {
    const candidates = ['text', 'value', 'paragraphList', 'paragraphs', 'sections', 'body', 'content'];
    for (const k of candidates) {
      if (parsed[k] != null) {
        const t = collectHwpText(parsed[k]);
        if (t) return t;
      }
    }
    // 마지막: 모든 string 값 수집
    const out: string[] = [];
    for (const v of Object.values(parsed)) {
      if (typeof v === 'string' && v.length > 1) out.push(v);
    }
    return out.join(' ');
  }
  return String(parsed);
}

function fallbackHwp(_input: ExtractInput, reason: string): ExtractResult {
  return {
    text: '',
    source: 'hwp',
    warnings: [
      `HWP 바이너리 텍스트 추출 실패 (${reason})`,
      'HWP 바이너리 직접 파싱은 한계가 있습니다 — 한컴오피스 SDK 또는 hwp5txt(서버) 권장.',
      'HWPX (한컴오피스 2014+ 신 포맷) 로 변환 후 다시 시도하면 정상 추출됩니다.',
    ],
  };
}

// ─────────────────────────────────────────────
// 이미지 — Tesseract.js (lazy)
// ─────────────────────────────────────────────

async function extractImage(input: ExtractInput): Promise<ExtractResult> {
  const { ocrImage } = await import('./ocr');
  const r = await ocrImage(input.data, ['kor', 'eng']);
  return {
    text: r.text,
    source: 'ocr',
    ocrApplied: true,
    ocrConfidence: r.confidence,
    ocrLanguages: r.languages,
  };
}

// ─────────────────────────────────────────────
// 메인 dispatch
// ─────────────────────────────────────────────

const EXT_DISPATCH: Record<string, (i: ExtractInput) => Promise<ExtractResult>> = {
  pdf:  extractPdf,
  docx: extractDocx,
  xlsx: extractXlsx, xls: extractXlsx,
  pptx: extractPptx,
  hwpx: extractHwpx,
  hwp:  extractHwp,
};

export async function extractText(input: ExtractInput): Promise<ExtractResult> {
  // 1) 평문 텍스트 — 가장 빠른 경로
  if (isPlainText(input)) {
    return { text: decodeText(input.data), source: 'text' };
  }

  // 2) 이미지 → OCR
  if (isImage(input)) {
    return extractImage(input);
  }

  // 3) 확장자 dispatch
  const e = ext(input.name);
  if (e in EXT_DISPATCH) {
    try {
      return await EXT_DISPATCH[e]!(input);
    } catch (err) {
      return {
        text: '',
        source: 'unsupported',
        warnings: [`${e.toUpperCase()} 추출 실패: ${(err as Error).message}`],
      };
    }
  }

  // 4) 매직 넘버 fallback (확장자 미일치)
  if (isHwpx(input.data)) {
    try { return await extractHwpx(input); } catch { /* fall through */ }
  }
  if (isHwpBinary(input.data)) {
    return extractHwp(input);
  }

  // 5) 미지원
  return {
    text: '',
    source: 'binary',
    warnings: [`확장자 ${e || '없음'} / MIME ${input.type || '없음'} — 텍스트 추출 미지원`],
  };
}

/**
 * 다중 파일 → 단일 텍스트 + 메타 통합.
 * UI 흐름에서 한 번에 호출.
 */
export async function extractAll(files: ExtractInput[]): Promise<{
  text: string;
  perFile: Array<{ name: string } & ExtractResult>;
  ocrApplied: boolean;
  ocrEngine?: 'tesseract.js';
  ocrConfidence?: number;
  ocrLanguages?: string[];
  warnings: string[];
}> {
  const perFile: Array<{ name: string } & ExtractResult> = [];
  for (const f of files) {
    const r = await extractText(f);
    perFile.push({ name: f.name, ...r });
  }
  const text = perFile.map(p => p.text).filter(t => t.length > 0).join('\n\n');
  const warnings = perFile.flatMap(p => p.warnings || []);
  const ocrFiles = perFile.filter(p => p.ocrApplied);
  const ocrApplied = ocrFiles.length > 0;
  return {
    text,
    perFile,
    ocrApplied,
    ocrEngine: ocrApplied ? 'tesseract.js' : undefined,
    ocrConfidence: ocrApplied
      ? ocrFiles.reduce((s, f) => s + (f.ocrConfidence || 0), 0) / ocrFiles.length
      : undefined,
    ocrLanguages: ocrApplied ? ocrFiles[0]?.ocrLanguages : undefined,
    warnings,
  };
}

// ─────────────────────────────────────────────
// XML 디코딩 헬퍼
// ─────────────────────────────────────────────

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * #8-A. 봉투 → PDF 변환 옵션
 *
 * 가명화/익명화 적용 후의 텍스트를 PDF 로 변환하면서 DPV 메타를
 * 헤더·푸터 워터마크로 모든 페이지에 삽입한다.
 *
 * 흐름:
 *   가명화된 file.data → text-extractor.extractAll() → text
 *     → jsPDF + 한국어 폰트 → 본문 + 헤더 + 푸터
 *     → 새 FileEntry { name: "...".pdf, data: PDF bytes }
 *
 * 변환 대상: 텍스트 기반 포맷만 — txt / md / csv / json / xml / log / yaml / tsv / docx
 * 비대상: xlsx / pptx / hwpx / hwp / pdf / 이미지 — 원본 유지 (셀·슬라이드·서식 손실 방지)
 */
import type { FileEntry } from '../compression/compressor';
import { extractText, type ExtractResult } from './text-extractor';
import { dpvLabel } from '../policy/standards/dpv-labels';

export interface PdfWatermarkMeta {
  /** 분류 등급 */
  grade: 'O' | 'S' | 'C';
  /** dpv:DataCategory IRI 목록 (예: dpv:NationalIdentifier) */
  dataCategories: string[];
  /** dpv:AppliedMeasure IRI 목록 (예: dpv:Pseudonymisation) */
  appliedMeasures: string[];
  /** 처리 의도 (internal / external) */
  purpose: 'internal' | 'external';
  /** 분류기 버전 */
  classifierVersion?: string;
  /** 봉투 생성일 (ISO) — 미지정 시 today */
  createdAt?: string;
}

export interface PdfConversionReport {
  filename: string;
  pdfFilename: string;
  pages: number;
  source: ExtractResult['source'];
  textChars: number;
  warnings?: string[];
}

const TEXT_BASED_EXTENSIONS = /^(txt|md|csv|json|xml|html?|log|yaml|yml|tsv|docx)$/i;

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** 변환 대상 여부 — 사용자 명세 8-2 (b) 텍스트 기반만 */
export function isConvertibleToPdf(filename: string): boolean {
  return TEXT_BASED_EXTENSIONS.test(ext(filename));
}

// ─────────────────────────────────────────────
// 한국어 폰트 lazy load (메인 번들에 포함 X)
// ─────────────────────────────────────────────

let cachedFontBase64: string | null = null;
let cachedFontName: string | null = null;

/**
 * public/fonts/ 의 한국어 폰트를 fetch → base64.
 * 없으면 영문만 가능 (한글 깨짐).
 *
 * 추가 방법: public/fonts/Pretendard-Regular.ttf (또는 NanumGothic-Regular.ttf) 저장.
 * OFL 라이센스 폰트 권장.
 */
async function loadKoreanFont(): Promise<{ base64: string; name: string } | null> {
  if (cachedFontBase64 && cachedFontName) {
    return { base64: cachedFontBase64, name: cachedFontName };
  }

  // 우선순위: Pretendard → NanumGothic
  const candidates = [
    { url: '/fonts/Pretendard-Regular.ttf', name: 'Pretendard' },
    { url: '/fonts/NanumGothic-Regular.ttf', name: 'NanumGothic' },
  ];

  for (const c of candidates) {
    try {
      const res = await fetch(c.url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      cachedFontBase64 = base64;
      cachedFontName = c.name;
      return { base64, name: c.name };
    } catch {
      // 다음 후보 시도
    }
  }
  return null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────
// 본문 + 워터마크 렌더링
// ─────────────────────────────────────────────

interface PdfBuildResult {
  data: Uint8Array;
  pages: number;
}

async function buildPdf(text: string, meta: PdfWatermarkMeta): Promise<PdfBuildResult> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  const font = await loadKoreanFont();
  if (font) {
    doc.addFileToVFS(`${font.name}-Regular.ttf`, font.base64);
    doc.addFont(`${font.name}-Regular.ttf`, font.name, 'normal');
    doc.setFont(font.name, 'normal');
  } else {
    doc.setFont('helvetica', 'normal');
  }

  // 페이지 메트릭
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const headerH = 28;
  const footerH = 24;
  const bodyTop = margin + headerH + 6;
  const bodyBottom = pageHeight - margin - footerH - 6;
  const bodyW = pageWidth - margin * 2;

  // 본문 렌더
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const lineH = 14;
  const wrapped = doc.splitTextToSize(text || '(빈 문서)', bodyW);
  let y = bodyTop;
  let pageCount = 1;

  for (let i = 0; i < wrapped.length; i++) {
    if (y > bodyBottom) {
      doc.addPage();
      pageCount += 1;
      if (font) doc.setFont(font.name, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);
      y = bodyTop;
    }
    doc.text(wrapped[i], margin, y);
    y += lineH;
  }

  // 헤더·푸터 — 모든 페이지 (사용자 명세 8-3 a)
  drawWatermark(doc, meta, pageCount, font?.name);

  const arr = doc.output('arraybuffer');
  return { data: new Uint8Array(arr), pages: pageCount };
}

function drawWatermark(
  doc: any,
  meta: PdfWatermarkMeta,
  pageCount: number,
  fontName: string | undefined,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  const date = (meta.createdAt || new Date().toISOString()).slice(0, 10);
  const gradeLabel = meta.grade === 'O' ? '일반(O)' : meta.grade === 'S' ? '민감(S)' : '엄중(C)';
  const purposeLabel = meta.purpose === 'external' ? '외부 전송' : '내부 보관';

  // 카테고리 라벨 (한국어, 최대 3개)
  const catLabels = meta.dataCategories.slice(0, 3).map(iri => dpvLabel(iri, 'ko')).join(' · ');
  const more = meta.dataCategories.length > 3 ? ` 외 ${meta.dataCategories.length - 3}` : '';
  const catLine = catLabels ? `데이터: ${catLabels}${more}` : '데이터: (분류 없음)';

  const measureLabels = meta.appliedMeasures.slice(0, 3).map(iri => dpvLabel(iri, 'ko')).join(' · ');
  const measureLine = measureLabels ? `조치: ${measureLabels}` : '';

  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    if (fontName) doc.setFont(fontName, 'normal');

    // 헤더 — 회색 가는 선 + 등급 + DPV 카테고리
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.line(margin, margin + 18, pageWidth - margin, margin + 18);

    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(`PKIZIP · ${gradeLabel} · ${purposeLabel}`, margin, margin + 10);
    doc.text(date, pageWidth - margin, margin + 10, { align: 'right' });

    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text(catLine, margin, margin + 16, { maxWidth: pageWidth - margin * 2 });

    // 푸터 — DPV 적용 조치 + 페이지 번호
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, pageHeight - margin - 16, pageWidth - margin, pageHeight - margin - 16);

    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    if (measureLine) doc.text(measureLine, margin, pageHeight - margin - 6);
    doc.text(`${p} / ${pageCount}`, pageWidth - margin, pageHeight - margin - 6, { align: 'right' });
  }
}

// ─────────────────────────────────────────────
// 파일 변환
// ─────────────────────────────────────────────

export async function convertFileToPdf(
  file: FileEntry,
  meta: PdfWatermarkMeta,
): Promise<{ file: FileEntry; report: PdfConversionReport }> {
  const extracted = await extractText({ name: file.name, type: file.type, data: file.data });
  const text = extracted.text || '';
  const built = await buildPdf(text, meta);

  const newName = file.name.replace(/\.[a-z0-9]+$/i, '') + '.pdf';
  const newFile: FileEntry = {
    ...file,
    name: newName,
    type: 'application/pdf',
    data: built.data,
    size: built.data.byteLength,
  };
  return {
    file: newFile,
    report: {
      filename: file.name,
      pdfFilename: newName,
      pages: built.pages,
      source: extracted.source,
      textChars: text.length,
      warnings: extracted.warnings,
    },
  };
}

export interface ConvertFilesResult {
  files: FileEntry[];
  reports: PdfConversionReport[];
  /** 변환되지 않고 원본 유지된 파일 (xlsx/pptx/이미지/PDF 등) */
  skipped: { filename: string; reason: string }[];
}

export async function convertConvertibleFilesToPdf(
  files: FileEntry[],
  meta: PdfWatermarkMeta,
): Promise<ConvertFilesResult> {
  const out: FileEntry[] = [];
  const reports: PdfConversionReport[] = [];
  const skipped: ConvertFilesResult['skipped'] = [];

  for (const f of files) {
    if (!isConvertibleToPdf(f.name)) {
      out.push(f);
      skipped.push({
        filename: f.name,
        reason: ext(f.name) === 'pdf' ? '이미 PDF — 그대로 봉투 포함'
              : /^(xlsx|xls|pptx|hwpx|hwp)$/i.test(ext(f.name)) ? '셀·슬라이드 서식 보존을 위해 변환 제외'
              : 'PDF 변환 비대상 포맷',
      });
      continue;
    }
    try {
      const { file: pdfFile, report } = await convertFileToPdf(f, meta);
      out.push(pdfFile);
      reports.push(report);
    } catch (err) {
      out.push(f);
      skipped.push({ filename: f.name, reason: `변환 실패: ${(err as Error).message}` });
    }
  }
  return { files: out, reports, skipped };
}

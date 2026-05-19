/**
 * 이미지 PII 마스킹 — OCR 좌표 기반.
 *
 * 흐름:
 *   1. PII detector findings (start, end) → text offset 구간
 *   2. OCR word bbox 트리에서 구간과 교차하는 모든 word 의 bbox 합집합
 *   3. 줄(line) 내 인접 word 묶어 하나의 박스로 병합 (시각적 깔끔함)
 *   4. Canvas 에 원본 이미지 그리고 박스만 검정으로 덮어쓰기 → PNG 변환
 *
 * 워커가 아닌 메인 스레드에서 동작. 큰 이미지 (>4MP) 는 호출 측에서 적절히
 * 다운스케일 검토 권장.
 */

import type { Finding, OcrWord } from './types';

export interface MaskBox {
  x: number; y: number; w: number; h: number;
  /** 이 박스가 가리는 PII entity 종류들 (디버그/메타용) */
  entityTypes: string[];
}

/**
 * findings 의 (start, end) 와 교차하는 word bbox 들을 찾아 박스로 합친다.
 * 같은 줄(같은 y 범위) 의 연속 word 는 하나로 병합한다.
 */
export function findingsToMaskBoxes(
  findings: readonly Finding[],
  words: readonly OcrWord[],
  padding: number = 4,
): MaskBox[] {
  if (!findings.length || !words.length) return [];

  // 각 finding 마다 교차하는 word 인덱스 수집
  const hits: Array<{ wordIdx: number; entityType: string }> = [];
  for (const f of findings) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      // 교차 조건: word 가 [start, end) 와 겹침
      if (w.textEnd > f.start && w.textStart < f.end) {
        hits.push({ wordIdx: i, entityType: f.entityType });
      }
    }
  }
  if (!hits.length) return [];

  // wordIdx 별로 entityTypes 누적
  const byWord = new Map<number, Set<string>>();
  for (const h of hits) {
    const s = byWord.get(h.wordIdx) ?? new Set<string>();
    s.add(h.entityType);
    byWord.set(h.wordIdx, s);
  }

  // 같은 줄(겹치는 y 범위) + word 인덱스 인접(±1) 이면 같은 박스로 병합
  const sortedIdx = [...byWord.keys()].sort((a, b) => a - b);
  const boxes: MaskBox[] = [];
  let cur: { idxs: number[]; types: Set<string> } | null = null;
  const sameLine = (a: OcrWord, b: OcrWord): boolean => {
    const aMid = (a.bbox.y0 + a.bbox.y1) / 2;
    const bMid = (b.bbox.y0 + b.bbox.y1) / 2;
    const aH = a.bbox.y1 - a.bbox.y0;
    return Math.abs(aMid - bMid) < aH * 0.6;
  };
  for (const idx of sortedIdx) {
    if (!cur) {
      cur = { idxs: [idx], types: new Set(byWord.get(idx)!) };
      continue;
    }
    const lastIdx = cur.idxs[cur.idxs.length - 1]!;
    const adjacent = idx - lastIdx === 1;
    const sameRow = sameLine(words[lastIdx]!, words[idx]!);
    if (adjacent && sameRow) {
      cur.idxs.push(idx);
      for (const t of byWord.get(idx)!) cur.types.add(t);
    } else {
      boxes.push(mergeToBox(cur.idxs, cur.types, words, padding));
      cur = { idxs: [idx], types: new Set(byWord.get(idx)!) };
    }
  }
  if (cur) boxes.push(mergeToBox(cur.idxs, cur.types, words, padding));
  return boxes;
}

function mergeToBox(idxs: number[], types: Set<string>, words: readonly OcrWord[], padding: number): MaskBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of idxs) {
    const b = words[i]!.bbox;
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return {
    x: Math.max(0, x0 - padding),
    y: Math.max(0, y0 - padding),
    w: (x1 - x0) + padding * 2,
    h: (y1 - y0) + padding * 2,
    entityTypes: [...types],
  };
}

/**
 * 원본 이미지(PNG/JPEG/WEBP 등 브라우저 디코드 가능 포맷) 위에 박스를 그려 PNG 로 출력.
 * EXIF / 원본 메타데이터는 Canvas 재인코딩 과정에서 자동 제거 (부수효과로 PII GPS 등 안전).
 *
 * 옵션:
 *   - style 'box' (기본): 검정 fillRect
 *   - style 'blur': Canvas filter='blur(8px)' 영역 — 일부 텍스트 복원 가능 (보수적)
 */
export async function applyMasksToImage(
  imageData: Uint8Array,
  boxes: readonly MaskBox[],
  opts: { style?: 'box' | 'blur'; mimeType?: string } = {},
): Promise<Uint8Array> {
  const blob = new Blob([imageData as BlobPart], { type: opts.mimeType || 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const style = opts.style ?? 'box';
  if (style === 'blur') {
    // 박스 단위로 영역만 blur 처리: 원본을 blurred 로 그려 그 영역만 다시 덮어쓰기
    for (const b of boxes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      (ctx as any).filter = 'blur(8px)';
      ctx.drawImage(canvas as any, 0, 0);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = '#000';
    for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  const outBlob = canvas instanceof OffscreenCanvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob failed')), 'image/png');
      });

  return new Uint8Array(await outBlob.arrayBuffer());
}

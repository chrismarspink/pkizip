'use client';

/**
 * LogoCrop — Canvas 기반 이미지 크롭 컴포넌트
 *
 * - 드래그앤드롭 이미지 업로드 (PNG/JPG/SVG/WebP)
 * - 드래그로 크롭 영역 선택, 4모서리 핸들로 크기 조절
 * - 크롭 박스 내부 드래그로 이동
 * - 터치/마우스 공통 처리
 * - 인증서 카드 (그린/노랑) 실시간 미리보기
 * - PNG 다운로드
 *
 * 의존성: Canvas API만 사용, 외부 라이브러리 없음
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, RotateCcw } from 'lucide-react';

/** 카드 색상 프리셋 */
const CARD_COLORS = [
  { id: 'navy',    label: 'Navy',    bg: 'linear-gradient(135deg, #175DDC, #0C3276)' },
  { id: 'violet',  label: 'Violet',  bg: 'linear-gradient(135deg, #7C3AED, #4C1D95)' },
  { id: 'teal',    label: 'Teal',    bg: 'linear-gradient(135deg, #0D9488, #134E4A)' },
  { id: 'slate',   label: 'Slate',   bg: 'linear-gradient(135deg, #475569, #1E293B)' },
  { id: 'rose',    label: 'Rose',    bg: 'linear-gradient(135deg, #E11D48, #881337)' },
  { id: 'amber',   label: 'Amber',   bg: 'linear-gradient(135deg, #F59E0B, #92400E)' },
  { id: 'emerald', label: 'Emerald', bg: 'linear-gradient(135deg, #10B981, #065F46)' },
  { id: 'sky',     label: 'Sky',     bg: 'linear-gradient(135deg, #0EA5E9, #0C4A6E)' },
];

export type CardColorId = string;
export const DEFAULT_CARD_COLOR = 'navy';

/**
 * colorId → CSS background 문자열
 * 프리셋: 'navy', 'violet' 등
 * 커스텀: 'custom::#FF0000::#0000FF' → linear-gradient(135deg, #FF0000, #0000FF)
 * 단색:   'solid::#FF0000' → #FF0000
 */
export function getCardBackground(colorId?: string): string {
  if (!colorId) return CARD_COLORS[0].bg;
  if (colorId.startsWith('custom::')) {
    const [, c1, c2] = colorId.split('::');
    return `linear-gradient(135deg, ${c1}, ${c2})`;
  }
  if (colorId.startsWith('solid::')) {
    return colorId.replace('solid::', '');
  }
  const found = CARD_COLORS.find(c => c.id === colorId);
  return found?.bg ?? CARD_COLORS[0].bg;
}

interface LogoCropProps {
  onCropComplete: (dataUrl: string) => void;
  cardColor?: CardColorId;
  onCardColorChange?: (color: CardColorId) => void;
}

interface CropBox { x: number; y: number; w: number; h: number; }
type DragMode = 'none' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'new';

const CANVAS_W = 480;
const CANVAS_H = 320;
const HANDLE = 10;
const MIN_SIZE = 20;

export function LogoCrop({ onCropComplete, cardColor = DEFAULT_CARD_COLOR, onCardColorChange }: LogoCropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imgFit, setImgFit] = useState<{ sx: number; sy: number; sw: number; sh: number }>({ sx: 0, sy: 0, sw: 0, sh: 0 });
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, w: 0, h: 0 });
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [startCrop, setStartCrop] = useState<CropBox | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // === 이미지 로드 ===
  const loadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setImage(img);

        // 이미지를 캔버스에 맞춰 비례 조정
        const ratio = Math.min(CANVAS_W / img.width, CANVAS_H / img.height);
        const sw = img.width * ratio;
        const sh = img.height * ratio;
        const sx = (CANVAS_W - sw) / 2;
        const sy = (CANVAS_H - sh) / 2;
        setImgFit({ sx, sy, sw, sh });

        // 초기 크롭: 정사각형 (이미지 짧은 변의 80%)
        const side = Math.min(sw, sh) * 0.8;
        setCrop({
          x: sx + (sw - side) / 2,
          y: sy + (sh - side) / 2,
          w: side,
          h: side,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadImage(f);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) loadImage(f);
  };

  // === Canvas 렌더링 ===
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 배경
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (!image) {
      // 플레이스홀더
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(10, 10, CANVAS_W - 20, CANVAS_H - 20);
      ctx.setLineDash([]);
      return;
    }

    // 이미지
    ctx.drawImage(image, imgFit.sx, imgFit.sy, imgFit.sw, imgFit.sh);

    // 어두운 오버레이 (크롭 박스 외부)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, CANVAS_W, crop.y);
    ctx.fillRect(0, crop.y, crop.x, crop.h);
    ctx.fillRect(crop.x + crop.w, crop.y, CANVAS_W - crop.x - crop.w, crop.h);
    ctx.fillRect(0, crop.y + crop.h, CANVAS_W, CANVAS_H - crop.y - crop.h);

    // 크롭 박스 테두리
    ctx.strokeStyle = '#175DDC';
    ctx.lineWidth = 2;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

    // 가이드 라인 (삼등분)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(crop.x + (crop.w / 3) * i, crop.y);
      ctx.lineTo(crop.x + (crop.w / 3) * i, crop.y + crop.h);
      ctx.moveTo(crop.x, crop.y + (crop.h / 3) * i);
      ctx.lineTo(crop.x + crop.w, crop.y + (crop.h / 3) * i);
      ctx.stroke();
    }

    // 4모서리 핸들
    const corners = [
      { x: crop.x, y: crop.y },
      { x: crop.x + crop.w, y: crop.y },
      { x: crop.x, y: crop.y + crop.h },
      { x: crop.x + crop.w, y: crop.y + crop.h },
    ];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#175DDC';
    ctx.lineWidth = 2;
    for (const c of corners) {
      ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
    }
  }, [image, imgFit, crop]);

  // === 크롭 결과 생성 ===
  useEffect(() => {
    if (!image || crop.w < MIN_SIZE || crop.h < MIN_SIZE) return;
    const hidden = hiddenCanvasRef.current;
    if (!hidden) return;
    const ctx = hidden.getContext('2d');
    if (!ctx) return;

    // 이미지 원본 좌표계로 변환
    const scale = image.width / imgFit.sw;
    const srcX = (crop.x - imgFit.sx) * scale;
    const srcY = (crop.y - imgFit.sy) * scale;
    const srcW = crop.w * scale;
    const srcH = crop.h * scale;

    // 64KB 이하 보장 — 최대 치수 + JPEG 품질 반복 조정
    const dataUrl = compressToTargetSize(ctx, hidden, image, srcX, srcY, srcW, srcH, 64 * 1024);
    // base64 → 대략 바이트 수 (data:image/jpeg;base64, 프리픽스 제외)
    const base64Only = dataUrl.split(',')[1] ?? '';
    const bytes = Math.floor(base64Only.length * 0.75);
    setPreviewUrl(dataUrl);
    setPreviewSize(bytes);
    onCropComplete(dataUrl);
  }, [image, imgFit, crop, onCropComplete]);

  // === 마우스/터치 이벤트 ===
  const getPt = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const pt = 'touches' in e ? e.touches[0] || e.changedTouches[0] : e;
    return {
      x: (pt.clientX - rect.left) * scaleX,
      y: (pt.clientY - rect.top) * scaleY,
    };
  };

  const hitHandle = (x: number, y: number): DragMode => {
    const c = crop;
    const near = (hx: number, hy: number) =>
      Math.abs(x - hx) <= HANDLE && Math.abs(y - hy) <= HANDLE;
    if (near(c.x, c.y)) return 'nw';
    if (near(c.x + c.w, c.y)) return 'ne';
    if (near(c.x, c.y + c.h)) return 'sw';
    if (near(c.x + c.w, c.y + c.h)) return 'se';
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return 'move';
    if (image && x >= imgFit.sx && x <= imgFit.sx + imgFit.sw &&
        y >= imgFit.sy && y <= imgFit.sy + imgFit.sh) return 'new';
    return 'none';
  };

  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!image) return;
    e.preventDefault();
    const pt = getPt(e);
    const mode = hitHandle(pt.x, pt.y);
    if (mode === 'none') return;
    setDragMode(mode);
    setStartPt(pt);
    setStartCrop({ ...crop });

    if (mode === 'new') {
      setCrop({ x: pt.x, y: pt.y, w: 0, h: 0 });
    }
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (dragMode === 'none' || !startPt || !startCrop || !image) return;
    e.preventDefault();
    const pt = getPt(e);
    const dx = pt.x - startPt.x;
    const dy = pt.y - startPt.y;

    const { sx, sy, sw, sh } = imgFit;
    const clampX = (v: number) => Math.max(sx, Math.min(v, sx + sw));
    const clampY = (v: number) => Math.max(sy, Math.min(v, sy + sh));

    let next: CropBox = { ...startCrop };

    // 정사각형 비율 강제 (1:1)
    if (dragMode === 'move') {
      next.x = clampX(startCrop.x + dx);
      next.y = clampY(startCrop.y + dy);
      if (next.x + next.w > sx + sw) next.x = sx + sw - next.w;
      if (next.y + next.h > sy + sh) next.y = sy + sh - next.h;
    } else if (dragMode === 'nw') {
      // 우하단 고정, 좌상단 이동 (대각선 평균값으로 정사각형 유지)
      const anchorX = startCrop.x + startCrop.w;
      const anchorY = startCrop.y + startCrop.h;
      const dragSize = Math.max(MIN_SIZE, Math.min(anchorX - clampX(startCrop.x + dx), anchorY - clampY(startCrop.y + dy)));
      const side = Math.min(dragSize, anchorX - sx, anchorY - sy);
      next.w = side; next.h = side;
      next.x = anchorX - side; next.y = anchorY - side;
    } else if (dragMode === 'ne') {
      // 좌하단 고정
      const anchorX = startCrop.x;
      const anchorY = startCrop.y + startCrop.h;
      const dragSize = Math.max(MIN_SIZE, Math.min(clampX(startCrop.x + startCrop.w + dx) - anchorX, anchorY - clampY(startCrop.y + dy)));
      const side = Math.min(dragSize, sx + sw - anchorX, anchorY - sy);
      next.w = side; next.h = side;
      next.x = anchorX; next.y = anchorY - side;
    } else if (dragMode === 'sw') {
      // 우상단 고정
      const anchorX = startCrop.x + startCrop.w;
      const anchorY = startCrop.y;
      const dragSize = Math.max(MIN_SIZE, Math.min(anchorX - clampX(startCrop.x + dx), clampY(startCrop.y + startCrop.h + dy) - anchorY));
      const side = Math.min(dragSize, anchorX - sx, sy + sh - anchorY);
      next.w = side; next.h = side;
      next.x = anchorX - side; next.y = anchorY;
    } else if (dragMode === 'se') {
      // 좌상단 고정
      const anchorX = startCrop.x;
      const anchorY = startCrop.y;
      const dragSize = Math.max(MIN_SIZE, Math.min(clampX(startCrop.x + startCrop.w + dx) - anchorX, clampY(startCrop.y + startCrop.h + dy) - anchorY));
      const side = Math.min(dragSize, sx + sw - anchorX, sy + sh - anchorY);
      next.w = side; next.h = side;
      next.x = anchorX; next.y = anchorY;
    } else if (dragMode === 'new') {
      const endX = clampX(pt.x);
      const endY = clampY(pt.y);
      const side = Math.min(Math.abs(endX - startPt.x), Math.abs(endY - startPt.y));
      next = {
        x: endX < startPt.x ? startPt.x - side : startPt.x,
        y: endY < startPt.y ? startPt.y - side : startPt.y,
        w: side,
        h: side,
      };
    }
    setCrop(next);
  };

  const onUp = () => {
    setDragMode('none');
    setStartPt(null);
    setStartCrop(null);
    // new 모드에서 너무 작으면 취소
    if (crop.w < MIN_SIZE || crop.h < MIN_SIZE) {
      setCrop(prev => ({ ...prev, w: Math.max(MIN_SIZE, prev.w), h: Math.max(MIN_SIZE, prev.h) }));
    }
  };

  const resetCrop = () => {
    if (!image) return;
    const cw = imgFit.sw * 0.8;
    const ch = imgFit.sh * 0.8;
    setCrop({
      x: imgFit.sx + (imgFit.sw - cw) / 2,
      y: imgFit.sy + (imgFit.sh - ch) / 2,
      w: cw,
      h: ch,
    });
  };

  const downloadPng = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = 'logo.png';
    a.click();
  };

  // 커서 계산
  const cursorFor = (mode: DragMode): string => {
    switch (mode) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'move': return 'move';
      case 'new': return 'crosshair';
      default: return 'default';
    }
  };

  return (
    <div className="space-y-4">
      {/* 업로드 영역 */}
      {!image ? (
        <div
          ref={containerRef}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            w-full border-2 border-dashed rounded-2xl cursor-pointer transition-colors
            flex flex-col items-center justify-center py-12 text-center
            ${isDragOver ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-300 hover:border-zinc-400'}
          `}
        >
          <Upload className="w-10 h-10 text-zinc-400 mb-2" />
          <p className="text-sm font-medium text-zinc-700">이미지를 드래그하거나 클릭하여 선택</p>
          <p className="text-xs text-zinc-400 mt-1">PNG, JPG, SVG, WebP 지원</p>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </div>
      ) : (
        <>
          {/* 크롭 캔버스 */}
          <div className="bg-zinc-100 rounded-2xl p-3">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="w-full rounded-xl touch-none"
              style={{
                cursor: cursorFor(dragMode === 'none' ? 'move' : dragMode),
                aspectRatio: `${CANVAS_W}/${CANVAS_H}`,
              }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={onDown}
              onTouchMove={onMove}
              onTouchEnd={onUp}
            />
          </div>

          {/* 액션 */}
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-sm border border-zinc-200 rounded-xl px-4 py-2 hover:bg-zinc-50"
            >
              <ImageIcon className="w-4 h-4" /> 다른 이미지
            </button>
            <button
              onClick={resetCrop}
              className="flex items-center gap-1.5 text-sm border border-zinc-200 rounded-xl px-4 py-2 hover:bg-zinc-50"
            >
              <RotateCcw className="w-4 h-4" /> 크롭 초기화
            </button>
            <button
              onClick={downloadPng}
              className="flex items-center gap-1.5 text-sm border border-zinc-200 rounded-xl px-4 py-2 hover:bg-zinc-50"
            >
              <Download className="w-4 h-4" /> PNG 다운로드
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          </div>

          {/* 인증서 카드 미리보기 + 컬러 선택 */}
          {previewUrl && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500 font-medium">인증서 카드 미리보기</p>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  previewSize < 64 * 1024
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {formatBytes(previewSize)}
                  {previewSize < 64 * 1024 ? ' ✓ 64KB 이하' : ' ⚠ 64KB 초과'}
                </span>
              </div>
              <PreviewCard logoUrl={previewUrl} background={getCardBackground(cardColor)} />
              {/* 컬러 피커 */}
              <CardColorPicker cardColor={cardColor} onChange={onCardColorChange} />
            </div>
          )}
        </>
      )}

      {/* 크롭 결과 추출용 hidden canvas */}
      <canvas ref={hiddenCanvasRef} className="hidden" />
    </div>
  );
}

// === 카드 컬러 피커 ===
function CardColorPicker({ cardColor, onChange }: { cardColor: string; onChange?: (c: string) => void }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customC1, setCustomC1] = useState('#175DDC');
  const [customC2, setCustomC2] = useState('#0C3276');
  const isCustom = cardColor.startsWith('custom::') || cardColor.startsWith('solid::');

  const applyCustom = () => {
    onChange?.(`custom::${customC1}::${customC2}`);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-400">카드 컬러</p>
      {/* 프리셋 */}
      <div className="flex gap-1.5 flex-wrap">
        {CARD_COLORS.map(c => (
          <button
            key={c.id}
            onClick={() => { onChange?.(c.id); setShowCustom(false); }}
            title={c.label}
            className={`w-7 h-7 rounded-lg border-2 transition-all ${
              cardColor === c.id ? 'border-zinc-800 scale-110' : 'border-transparent hover:border-zinc-300'
            }`}
            style={{ background: c.bg }}
          />
        ))}
        {/* 커스텀 토글 */}
        <button
          onClick={() => setShowCustom(!showCustom)}
          title="커스텀 그라디언트"
          className={`w-7 h-7 rounded-lg border-2 text-[10px] font-bold transition-all ${
            isCustom || showCustom ? 'border-zinc-800 scale-110 bg-zinc-100' : 'border-zinc-200 hover:border-zinc-400 bg-white'
          }`}
        >
          +
        </button>
      </div>
      {/* 커스텀 그라디언트 입력 */}
      {showCustom && (
        <div className="bg-zinc-50 rounded-lg p-3 space-y-2">
          <p className="text-[10px] text-zinc-500">커스텀 그라디언트</p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              시작
              <input type="color" value={customC1} onChange={e => { setCustomC1(e.target.value); }}
                className="w-7 h-7 rounded border border-zinc-200 cursor-pointer p-0" />
            </label>
            <div className="flex-1 h-6 rounded" style={{ background: `linear-gradient(90deg, ${customC1}, ${customC2})` }} />
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              끝
              <input type="color" value={customC2} onChange={e => { setCustomC2(e.target.value); }}
                className="w-7 h-7 rounded border border-zinc-200 cursor-pointer p-0" />
            </label>
          </div>
          <button onClick={applyCustom}
            className="w-full text-[11px] bg-zinc-800 text-white rounded-lg py-1.5 hover:bg-zinc-700 transition-colors">
            적용
          </button>
        </div>
      )}
    </div>
  );
}

// === 인증서 카드 미리보기 ===
function PreviewCard({ logoUrl, background }: { logoUrl: string; background?: string }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: 320, height: 202, borderRadius: 14,
        background: background || 'linear-gradient(135deg, #175DDC, #0C3276)',
        color: 'white',
      }}
    >
      {/* 로고 영역: 좌상단 */}
      <div
        className="absolute top-3 left-3 flex items-center"
        style={{ height: 22, maxWidth: 80 }}
      >
        <img
          src={logoUrl}
          alt=""
          style={{
            maxHeight: 22, maxWidth: 80, objectFit: 'contain',
            filter: 'brightness(0) invert(1)',
          }}
        />
      </div>

      {/* 예시 콘텐츠 */}
      <div className="absolute inset-0 p-4 flex flex-col justify-end">
        <div className="text-xs opacity-80">인증서</div>
        <div className="text-xl font-bold mt-1">Sample Name</div>
        <div className="text-[10px] opacity-60 mt-1">2036.04.15 까지</div>
      </div>
    </div>
  );
}

/**
 * 크롭 결과를 목표 크기(바이트) 이하로 압축
 *
 * 전략:
 *   1. 최대 치수를 256→192→128→96→64로 단계적으로 줄임
 *   2. JPEG 품질을 0.85→0.7→0.55→0.4로 낮춤
 *   3. 각 조합에서 base64 크기를 측정, 목표 이하면 반환
 *   4. 모든 조합 실패 시 가장 작은 결과 반환
 */
function compressToTargetSize(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  sx: number, sy: number, sw: number, sh: number,
  targetBytes: number
): string {
  // 작은 치수부터 시도 (빠르게 목표 도달)
  const MAX_DIMS = [128, 96, 72, 56, 40, 32];
  const QUALITIES = [0.75, 0.6, 0.5, 0.4, 0.3, 0.2];

  // data URL 프리픽스(약 22자) + base64 확장(1.333배) + 인증서 ASN.1 오버헤드 고려
  // 실제 저장되는 이진 크기를 목표로 역산: dataUrl.length * 0.72 ≈ 실제 바이트
  const measureBytes = (dataUrl: string): number => {
    const base64 = dataUrl.split(',')[1] ?? '';
    // 패딩 고려한 정확한 계산: base64 길이 * 3/4 - padding
    const padding = (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    return Math.floor((base64.length * 3) / 4) - padding;
  };

  let bestDataUrl = '';
  let bestSize = Infinity;

  for (const maxDim of MAX_DIMS) {
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // JPEG 알파 채널 없음 → 투명 배경을 흰색으로
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);

    for (const q of QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      const bytes = measureBytes(dataUrl);

      if (bytes < bestSize) {
        bestSize = bytes;
        bestDataUrl = dataUrl;
      }
      if (bytes <= targetBytes) {
        return dataUrl;
      }
    }
  }

  return bestDataUrl;
}

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

'use client';

/**
 * TaskStream — Claude Code 스타일 실시간 작업 진행 UI
 *
 * 특징:
 *   - 단계별 상태: done (●초록) / active (●노랑) / pending (○회색)
 *   - 단계 사이 설명 텍스트/옵션 버튼/비밀번호 입력/인증서 카드 삽입 가능
 *   - 실시간 스트리밍 효과 (useTaskStream 훅으로 순차 표시)
 *
 * React + CSS만 사용, 외부 라이브러리 없음
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Identicon } from '@/components/cert/Identicon';

// === 타입 정의 ===

export type TaskStatus = 'done' | 'active' | 'pending' | 'error';

export interface StepItem {
  type: 'step';
  id: string;
  label: string;
  status: TaskStatus;
  detail?: string;
  icon?: React.ReactNode;
}

export interface TextItem {
  type: 'text';
  id: string;
  content: string;
  tone?: 'default' | 'muted' | 'success' | 'warning' | 'error';
}

export interface OptionsItem {
  type: 'options';
  id: string;
  options: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'default' }>;
  question?: string;
}

export interface InputItem {
  type: 'input';
  id: string;
  kind: 'password' | 'pin' | 'text';
  placeholder?: string;
  prompt?: string;
  onSubmit: (value: string) => void;
}

export interface CertItem {
  type: 'cert';
  id: string;
  name: string;
  email?: string;
  fingerprint: string;
  valid?: boolean;
  issuedAt?: number;
  expiresAt?: number;
  logotype?: string;
}

export interface SpinnerItem {
  type: 'spinner';
  id: string;
  label: string;
}

export type StreamItem = StepItem | TextItem | OptionsItem | InputItem | CertItem | SpinnerItem;

// === 메인 컴포넌트 ===

interface TaskStreamProps {
  items: StreamItem[];
  streamDelay?: number;   // 각 아이템 표시 간격 (ms), 0이면 즉시
  className?: string;
}

export function TaskStream({ items, streamDelay = 0, className }: TaskStreamProps) {
  const [visibleCount, setVisibleCount] = useState(streamDelay > 0 ? 0 : items.length);

  useEffect(() => {
    if (streamDelay <= 0) {
      setVisibleCount(items.length);
      return;
    }
    if (visibleCount >= items.length) return;
    const t = setTimeout(() => setVisibleCount(c => Math.min(c + 1, items.length)), streamDelay);
    return () => clearTimeout(t);
  }, [visibleCount, items.length, streamDelay]);

  // items가 새로 추가되면 (스트리밍) 자동 확장
  useEffect(() => {
    if (streamDelay <= 0) setVisibleCount(items.length);
  }, [items.length, streamDelay]);

  const visible = items.slice(0, visibleCount);

  return (
    <div className={`task-stream ${className ?? ''}`}>
      {visible.map((item, idx) => (
        <TaskStreamRow key={item.id} item={item} isLast={idx === visible.length - 1} />
      ))}
    </div>
  );
}

// === 단일 행 ===

function TaskStreamRow({ item, isLast }: { item: StreamItem; isLast: boolean }) {
  return (
    <div className={`ts-row ts-row-${item.type}`}>
      <div className="ts-gutter">
        <TaskStreamDot item={item} />
        {!isLast && <div className="ts-line" />}
      </div>
      <div className="ts-content">
        <TaskStreamContent item={item} />
      </div>
    </div>
  );
}

// === Gutter 아이콘 (좌측 타임라인 점) ===

function TaskStreamDot({ item }: { item: StreamItem }) {
  if (item.type === 'step') {
    return (
      <div className={`ts-dot ts-dot-${item.status}`}>
        {item.status === 'done' && <CheckIcon />}
        {item.status === 'active' && <span className="ts-dot-pulse" />}
        {item.status === 'error' && <XIcon />}
      </div>
    );
  }
  if (item.type === 'cert') {
    return <div className="ts-dot ts-dot-cert">◆</div>;
  }
  if (item.type === 'spinner') {
    return (
      <div className="ts-dot ts-dot-active">
        <Spinner />
      </div>
    );
  }
  if (item.type === 'input' || item.type === 'options') {
    return <div className="ts-dot ts-dot-input">?</div>;
  }
  return <div className="ts-dot ts-dot-text">·</div>;
}

// === Content 본문 ===

function TaskStreamContent({ item }: { item: StreamItem }) {
  if (item.type === 'step') {
    return (
      <div className="ts-step">
        <span className={`ts-step-label ts-step-${item.status}`}>{item.label}</span>
        {item.detail && <span className="ts-step-detail">{item.detail}</span>}
      </div>
    );
  }

  if (item.type === 'text') {
    return <div className={`ts-text ts-text-${item.tone ?? 'default'}`}>{item.content}</div>;
  }

  if (item.type === 'options') {
    return (
      <div className="ts-options">
        {item.question && <div className="ts-options-q">{item.question}</div>}
        <div className="ts-options-buttons">
          {item.options.map((opt, i) => (
            <button
              key={i}
              onClick={opt.onClick}
              className={`ts-option-btn ts-option-${opt.variant ?? 'default'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (item.type === 'input') {
    return <InputField item={item} />;
  }

  if (item.type === 'cert') {
    return <CertCard item={item} />;
  }

  if (item.type === 'spinner') {
    return <div className="ts-spinner-label">{item.label}</div>;
  }

  return null;
}

// === 입력 필드 ===

function InputField({ item }: { item: InputItem }) {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!value) return;
    setSubmitted(true);
    item.onSubmit(value);
  };

  if (submitted) {
    return (
      <div className="ts-input-submitted">
        {item.kind === 'password' || item.kind === 'pin' ? '●●●●●● 입력됨' : `${value} 입력됨`}
      </div>
    );
  }

  const isNumeric = item.kind === 'pin';
  return (
    <div className="ts-input">
      {item.prompt && <div className="ts-input-prompt">{item.prompt}</div>}
      <div className="ts-input-row">
        <input
          type={item.kind === 'text' ? 'text' : 'password'}
          inputMode={isNumeric ? 'numeric' : undefined}
          pattern={isNumeric ? '[0-9]*' : undefined}
          maxLength={isNumeric ? 6 : undefined}
          value={value}
          onChange={e => setValue(isNumeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
          placeholder={item.placeholder}
          className="ts-input-field"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <button onClick={handleSubmit} className="ts-input-btn">확인</button>
      </div>
    </div>
  );
}

// === 인증서 카드 ===

function CertCard({ item }: { item: CertItem }) {
  const fmtDate = (ts?: number) => ts ? new Date(ts).toLocaleDateString('ko-KR') : '';
  return (
    <div className={`ts-cert ${item.valid === false ? 'ts-cert-invalid' : item.valid === true ? 'ts-cert-valid' : ''}`}>
      <div className="ts-cert-avatar">
        {item.logotype ? (
          <img src={item.logotype} alt="" className="ts-cert-logo" />
        ) : (
          <Identicon value={item.fingerprint} size={48} />
        )}
      </div>
      <div className="ts-cert-info">
        <div className="ts-cert-name">
          {item.name}
          {item.valid === true && <span className="ts-cert-badge ts-cert-badge-valid">✓ 유효</span>}
          {item.valid === false && <span className="ts-cert-badge ts-cert-badge-invalid">✗ 무효</span>}
        </div>
        {item.email && <div className="ts-cert-email">{item.email}</div>}
        <div className="ts-cert-fp">0x{item.fingerprint}</div>
        {(item.issuedAt || item.expiresAt) && (
          <div className="ts-cert-date">
            {item.issuedAt && `${fmtDate(item.issuedAt)} ~ `}
            {item.expiresAt && fmtDate(item.expiresAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// === 아이콘 ===

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" className="ts-spinner-svg">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="7" />
    </svg>
  );
}

// === Hook: 스트리밍 아이템 추가 ===

export function useTaskStream() {
  const [items, setItems] = useState<StreamItem[]>([]);

  const push = useCallback((item: StreamItem) => {
    setItems(prev => [...prev, item]);
  }, []);

  const update = useCallback((id: string, patch: Partial<StreamItem>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } as StreamItem : it));
  }, []);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const reset = useCallback(() => setItems([]), []);

  const api = useMemo(() => ({ push, update, remove, reset }), [push, update, remove, reset]);
  return { items, ...api };
}

// === 인라인 스타일 주입 ===
// CSS를 한 곳에 모아서 외부 CSS 파일 없이 동작
export const TASK_STREAM_STYLES = `
.task-stream {
  --line-color: #e4e4e7;
  --dot-bg: #ffffff;
  font-size: 13px;
  line-height: 1.5;
}
.ts-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  min-height: 24px;
}
.ts-gutter {
  flex-shrink: 0;
  width: 20px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ts-line {
  flex: 1;
  width: 2px;
  background: var(--line-color);
  margin-top: 2px;
  min-height: 8px;
}
.ts-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  z-index: 1;
  background: var(--dot-bg);
  border: 2px solid var(--line-color);
}
.ts-dot-done {
  background: #1DC078;
  border-color: #1DC078;
}
.ts-dot-active {
  background: #facc15;
  border-color: #facc15;
  color: #78350f;
}
.ts-dot-error {
  background: #ef4444;
  border-color: #ef4444;
}
.ts-dot-pending {
  background: #ffffff;
  border-color: #d4d4d8;
  color: #a1a1aa;
}
.ts-dot-text {
  background: transparent;
  border-color: transparent;
  color: #a1a1aa;
  font-size: 16px;
}
.ts-dot-cert {
  background: #ffffff;
  border-color: #3b82f6;
  color: #3b82f6;
  font-size: 9px;
}
.ts-dot-input {
  background: #ffffff;
  border-color: #a1a1aa;
  color: #52525b;
}
.ts-dot-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #78350f;
  animation: ts-pulse 1.2s ease-in-out infinite;
}
@keyframes ts-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
.ts-spinner-svg {
  animation: ts-spin 0.8s linear infinite;
}
@keyframes ts-spin {
  to { transform: rotate(360deg); }
}
.ts-content {
  flex: 1;
  padding-top: 1px;
  padding-bottom: 8px;
  min-width: 0;
}
.ts-step {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ts-step-label {
  font-weight: 500;
  color: #18181b;
}
.ts-step-done { color: #16a34a; }
.ts-step-active { color: #18181b; }
.ts-step-pending { color: #a1a1aa; }
.ts-step-error { color: #dc2626; }
.ts-step-detail {
  color: #71717a;
  font-size: 11px;
}
.ts-text {
  color: #52525b;
  font-size: 12px;
  padding: 4px 0;
}
.ts-text-muted { color: #a1a1aa; }
.ts-text-success { color: #16a34a; }
.ts-text-warning { color: #d97706; }
.ts-text-error { color: #dc2626; }
.ts-options {
  padding: 8px 0;
}
.ts-options-q {
  color: #52525b;
  margin-bottom: 8px;
  font-size: 12px;
}
.ts-options-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ts-option-btn {
  border: 1px solid #e4e4e7;
  background: #ffffff;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.ts-option-btn:hover {
  border-color: #18181b;
  background: #fafafa;
}
.ts-option-primary {
  background: #18181b;
  color: #ffffff;
  border-color: #18181b;
}
.ts-option-primary:hover {
  background: #3f3f46;
}
.ts-input {
  padding: 6px 0;
  max-width: 420px;
}
.ts-input-prompt {
  color: #52525b;
  margin-bottom: 6px;
  font-size: 12px;
}
.ts-input-row {
  display: flex;
  gap: 6px;
}
.ts-input-field {
  flex: 1;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: ui-monospace, Menlo, monospace;
  letter-spacing: 0.1em;
  outline: none;
  transition: border-color 0.15s;
}
.ts-input-field:focus {
  border-color: #1DC078;
  box-shadow: 0 0 0 3px rgba(29, 192, 120, 0.15);
}
.ts-input-btn {
  background: #18181b;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 0 16px;
  font-size: 12px;
  cursor: pointer;
}
.ts-input-submitted {
  color: #71717a;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
}
.ts-cert {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  background: #f9fafb;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  align-items: center;
  margin: 4px 0;
}
.ts-cert-valid {
  background: #f0fdf4;
  border-color: #86efac;
}
.ts-cert-invalid {
  background: #fef2f2;
  border-color: #fca5a5;
}
.ts-cert-avatar {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ts-cert-logo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ts-cert-info {
  flex: 1;
  min-width: 0;
}
.ts-cert-name {
  font-weight: 600;
  font-size: 13px;
  color: #18181b;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-cert-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 9999px;
  font-weight: 500;
}
.ts-cert-badge-valid {
  background: #16a34a;
  color: #ffffff;
}
.ts-cert-badge-invalid {
  background: #dc2626;
  color: #ffffff;
}
.ts-cert-email {
  color: #71717a;
  font-size: 11px;
  margin-top: 2px;
}
.ts-cert-fp {
  color: #a1a1aa;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10px;
  margin-top: 2px;
}
.ts-cert-date {
  color: #a1a1aa;
  font-size: 10px;
  margin-top: 2px;
}
.ts-spinner-label {
  color: #52525b;
  font-size: 12px;
}
`;

// 컴포넌트가 처음 로드될 때 스타일을 문서에 주입
if (typeof document !== 'undefined' && !document.getElementById('task-stream-styles')) {
  const style = document.createElement('style');
  style.id = 'task-stream-styles';
  style.textContent = TASK_STREAM_STYLES;
  document.head.appendChild(style);
}

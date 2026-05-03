/**
 * 분석 결과 다이얼로그 — Step (2)~(5) UI.
 *
 * 표시:
 *   - 등급 뱃지 (C/S/O) + 신뢰도 + 점수
 *   - 자연어 설명 (explainer)
 *   - 판정 근거 표 (top reasons)
 *   - 가명/익명화 옵션
 *   - 정책 결정 (OPA)
 *   - "이 옵션 다음에도 사용" 체크박스 (디폴트 저장)
 *
 * 결과 → 부모 컴포넌트가 PkiHeader 에 매핑.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, AlertTriangle, CheckCircle2, FileSearch, Sparkles, Eye, Highlighter, ListTree, BookOpen, UserCheck, Save, Table, Cpu, Zap } from 'lucide-react';
import type { AnalysisResult, Grade } from '@/lib/analysis/types';
import { downgradeToTarget, anonymizeOnce } from '@/lib/analysis/pipeline';
import { loadPolicy } from '@/lib/analysis/anonymization-policy';
import { findKeywordOccurrences } from '@/lib/analysis/classifier';
import { listRecognizers, type RecognizerInfo } from '@/lib/analysis/pii-detector';
import * as neuralNer from '@/lib/analysis/neural-ner';
import { computeAttributions, buildAttributionHtml, type AttributionResult } from '@/lib/analysis/shap-attribution';
import { saveDecision, textHash, listDecisions } from '@/lib/learning/decision-store';
import { evaluate, REASON_MESSAGES, ACTION_MESSAGES, type PolicyDecision } from '@/lib/policy/opa-engine';
import { prefs, type CryptoKind, type Purpose } from '@/lib/store/preferences';

interface Props {
  open: boolean;
  initialResult: AnalysisResult;
  onClose: () => void;
  onAccept: (decision: AnalysisDecision) => void;
}

export interface AnalysisDecision {
  /** 사용자가 최종 채택한 결과 — 송신·암호화에 사용될 텍스트/메타 */
  result: AnalysisResult;
  /** 워크플로 의도 */
  intent: { purpose: Purpose; cryptoKind: CryptoKind };
  /** 정책 결정 */
  policy: PolicyDecision;
  /** 가명/익명화 적용 여부 */
  anonymizationAction: 'pseudonymize' | 'anonymize' | 'skip';
}

const GRADE_COLOR: Record<Grade, string> = {
  C: 'bg-red-50 text-red-700 border-red-300',
  S: 'bg-amber-50 text-amber-700 border-amber-300',
  O: 'bg-emerald-50 text-emerald-700 border-emerald-300',
};
const GRADE_LABEL: Record<Grade, string> = {
  C: '🔴 위험 (Critical)', S: '🟡 민감 (Sensitive)', O: '🟢 공개 (Open)',
};
const GRADE_RANK: Record<Grade, number> = { O: 0, S: 1, C: 2 };
const REASON_KIND_LABEL: Record<string, string> = {
  entity: 'PII',
  keyword: '키워드',
  language: '언어',
};

export function AnalysisDialog({ open, initialResult, onClose, onAccept }: Props) {
  // Step 1: 의도 (디폴트는 prefs)
  const [intent, setIntent] = useState(() => {
    const w = prefs.workflow.get();
    return { purpose: w.purpose, cryptoKind: w.cryptoKind };
  });

  // 가명/익명 디폴트
  const anonPrefs = useMemo(() => prefs.anon.get(), []);
  const [anonAction, setAnonAction] = useState<'pseudonymize' | 'anonymize' | 'skip'>(
    anonPrefs.defaultAction,
  );
  const [rememberDefaults, setRememberDefaults] = useState(true);
  const [showExplain, setShowExplain] = useState(true);

  // 사용자 최종 분류 — 현재 (가명화 후) AI 등급에서 시작, 사용자가 변경 가능
  // userManuallyPicked = true 이면 가명화로 current 가 바뀌어도 사용자 선택 유지.
  const [userGrade, setUserGrade] = useState<Grade>(initialResult.classification.grade);
  const [userManuallyPicked, setUserManuallyPicked] = useState(false);
  const [userMemo, setUserMemo] = useState('');
  const [decisionSaved, setDecisionSaved] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);

  // 모델 헤더 — 학습 기준 N건 + 적용시각 (decision-store 에서 읽음)
  const [modelStats, setModelStats] = useState<{ count: number; lastTs?: number }>({ count: 0 });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listDecisions(10_000);
        if (cancelled) return;
        setModelStats({ count: all.length, lastTs: all[0]?.ts });
      } catch (e) {
        console.warn('[AnalysisDialog] decisionStats failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [decisionSaved]);

  // 활성 인식기 — 정규식 / denylist + 신경망 NER 상태
  const recognizers = useMemo<RecognizerInfo[]>(() => listRecognizers(), []);
  const nerStatus = useMemo(() => neuralNer.status(), [decisionSaved]);
  const neuralPrefs = useMemo(() => prefs.neural?.get?.() ?? { nerEnabled: false, nerAutoLoad: false, nerMinScore: 0.5 }, []);

  // 분석 결과 (가명/익명화 후 갱신될 수 있음)
  const [current, setCurrent] = useState<AnalysisResult>(initialResult);

  // current 등급 변화 시 (가명/익명화 적용) — 사용자가 직접 picker 를 누르지
  // 않았다면 userGrade 도 같이 따라가게. 이렇게 해야 등급 카드와 picker 의
  // "AI 추천" 별이 서로 다른 등급을 가리키지 않음.
  useEffect(() => {
    if (!userManuallyPicked) setUserGrade(current.classification.grade);
  }, [current.classification.grade, userManuallyPicked]);

  // SHAP 토큰 기여도 — 사용자가 명시적으로 실행
  const [shapResult, setShapResult] = useState<AttributionResult | null>(null);
  const [shapRunning, setShapRunning] = useState(false);
  // current 가 바뀌면 (가명/익명화 적용) 기존 결과 무효화
  useEffect(() => { setShapResult(null); }, [current.text]);

  function runShap() {
    if (shapRunning) return;
    setShapRunning(true);
    // setTimeout 으로 yield → "분석 중…" UI 가 먼저 렌더되도록
    setTimeout(() => {
      try {
        const r = computeAttributions(current.text, current.classification, {
          maxTokens: 200,
          minDelta: 0.05,
        });
        setShapResult(r);
      } catch (e) {
        console.error('[SHAP] failed', e);
        alert('SHAP 분석 실패: ' + String(e));
      } finally {
        setShapRunning(false);
      }
    }, 30);
  }

  const autoAppliedRef = useRef(false);
  useEffect(() => {
    setCurrent(initialResult);
    autoAppliedRef.current = false;
    setUserGrade(initialResult.classification.grade);
    setUserManuallyPicked(false);
    setUserMemo('');
    setDecisionSaved(false);
  }, [initialResult]);

  // 디폴트 액션 자동 적용 — O 등급 아니고 디폴트가 'skip' 이 아니면 즉시 실행
  // 사용자는 클릭 없이 다이얼로그 진입만으로 권장 처리가 끝남
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (!initialResult) return;
    if (initialResult.classification.grade === 'O') return;
    if (anonAction === 'skip') return;
    autoAppliedRef.current = true;
    runAnonymization(anonAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialResult]);

  // 정책 평가
  const [policy, setPolicy] = useState<PolicyDecision | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const decision = await evaluate({
        intent: { purpose: intent.purpose, crypto_kind: intent.cryptoKind },
        classification: {
          grade: current.classification.grade,
          score: current.classification.score,
          confidence: current.classification.confidence,
        },
        pseudonymization: {
          applied: !!current.anonymization,
          is_reversible: current.anonymization?.result.isReversible ?? false,
          final_grade: current.anonymization?.finalGrade,
        },
        language: { detected: current.language.detected },
        ocr: { applied: !!current.ocr?.applied },
      });
      if (!cancelled) setPolicy(decision);
    })();
    return () => { cancelled = true; };
  }, [intent, current]);

  // 가명/익명화 실행
  function runAnonymization(kind: 'pseudonymize' | 'anonymize') {
    const policy = loadPolicy();
    // 가명 = consistent replace 위주, 익명 = generalize/shift 위주
    // 현재는 정책 그대로 적용. 차후 entity 별 method 자동 분기 추가 가능.
    if (anonPrefs.targetGrade === 'O') {
      const next = downgradeToTarget(current, { policy });
      setCurrent(next);
    } else {
      const next = anonymizeOnce(current, { policy });
      setCurrent(next);
    }
    void kind;
  }

  function handleAccept() {
    if (!policy) return;
    if (rememberDefaults) {
      prefs.workflow.set({ purpose: intent.purpose, cryptoKind: intent.cryptoKind });
      prefs.anon.set({ defaultAction: anonAction });
    }
    onAccept({ result: current, intent, policy, anonymizationAction: anonAction });
  }

  async function handleSaveDecision() {
    if (savingDecision) return;
    setSavingDecision(true);
    try {
      // 사용자가 picker 에서 본 AI 추천 = current (가명화 후 최종) 의 등급.
      // 동의 여부 (gap) 가 picker UI 와 일치하려면 current 기준으로 저장해야 함.
      const c0 = current.classification;
      const hash = await textHash(current.text);
      await saveDecision({
        textHash: hash,
        textLength: current.text.length,
        ai: {
          grade: c0.grade,
          score: c0.score,
          confidence: c0.confidence,
          version: c0.version,
          reasons: c0.reasons,
        },
        userGrade,
        memo: userMemo,
        findings: current.findings,
        language: current.language.detected,
      });
      setDecisionSaved(true);
    } catch (e) {
      console.error('[AnalysisDialog] saveDecision failed', e);
      alert('결정 저장 실패: ' + String(e));
    } finally {
      setSavingDecision(false);
    }
  }

  const userGradeGap = Math.abs(GRADE_RANK[current.classification.grade] - GRADE_RANK[userGrade]);

  if (!open) return null;
  const c = current.classification;
  const expl = current.explanation;
  const findingsBy = useMemo(() => {
    const out = new Map<string, number>();
    for (const f of current.findings) out.set(f.entityType, (out.get(f.entityType) || 0) + 1);
    return Array.from(out.entries()).sort((a, b) => b[1] - a[1]);
  }, [current.findings]);

  // 본문 하이라이트 — PII findings + 등급 키워드 매칭 위치
  const highlightedHtml = useMemo(() => {
    return buildHighlight(current.text, current.findings, findKeywordOccurrences(current.text));
  }, [current.text, current.findings]);
  const noPIIButGrade = current.findings.length === 0 && c.grade !== 'O';
  // 등급을 끌어올린 실제 원인 — 키워드 / 언어 하한 / 둘 다
  const hasKeywordReason = c.reasons.some(r => r.kind === 'keyword');
  const hasLanguageReason = c.reasons.some(r => r.kind === 'language');
  const noPIINoSignalReasonText = hasKeywordReason && hasLanguageReason
    ? '본문에 등급 키워드(노란색 강조) + 비한국어 하한이 적용되었습니다.'
    : hasKeywordReason
      ? '본문에 등급 키워드(아래 노란색 강조)가 포함된 경우입니다.'
      : hasLanguageReason
        ? `비한국어 (${current.language.detected}) 로 감지되어 보수적으로 ${c.grade} 하한이 적용되었습니다.`
        : '판정 근거 표를 확인해주세요.';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
          className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between p-5 border-b">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileSearch className="w-5 h-5 text-blue-600" /> 분석 결과 확인
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                옵션 → 등급 → 가명처리 → 정책 검사 한 번에
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-right text-[11px] leading-tight">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-mono text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  모델: {c.version}
                </div>
                <div className="text-zinc-500 mt-1">
                  학습 기준 <b className="text-zinc-700">{modelStats.count}</b>건
                  {modelStats.lastTs && (
                    <> · 적용시각 <span className="font-mono">{formatTs(modelStats.lastTs)}</span></>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 본문 */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">

            {/* 1. 사용 의도 */}
            <section className="border rounded-lg p-3">
              <div className="text-xs font-semibold text-zinc-500 uppercase mb-2">1. 사용 의도</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">보관 위치</label>
                  <select
                    value={intent.purpose}
                    onChange={e => setIntent({ ...intent, purpose: e.target.value as Purpose })}
                    className="w-full mt-1 px-2 py-1.5 border rounded text-sm"
                  >
                    <option value="internal">내부 보관</option>
                    <option value="external">외부 전송</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">암호 방식</label>
                  <select
                    value={intent.cryptoKind}
                    onChange={e => setIntent({ ...intent, cryptoKind: e.target.value as CryptoKind })}
                    className="w-full mt-1 px-2 py-1.5 border rounded text-sm"
                  >
                    <option value="classic">단순 (Legacy)</option>
                    <option value="hybrid">하이브리드 (PQC + Legacy)</option>
                    <option value="pqc-only">PQC Only (양자내성)</option>
                    <option value="pqc-he">PQC + HE 검색키</option>
                  </select>
                </div>
              </div>
            </section>

            {/* 2. 등급 카드 */}
            <section className={`border rounded-lg p-3 ${GRADE_COLOR[c.grade]}`}>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold w-10 text-center">{c.grade}</div>
                <div className="flex-1">
                  <div className="font-semibold">{GRADE_LABEL[c.grade]}</div>
                  <div className="text-xs opacity-80 mt-0.5">
                    score <b>{c.score}</b> · 신뢰도 {(c.confidence * 100).toFixed(0)}%
                    {' '}· 임계값 S=<b>{c.thresholds.S}</b> C=<b>{c.thresholds.C}</b>
                    {current.language.detected && current.language.detected !== 'und' && (
                      <> · 언어 {current.language.detected}</>
                    )}
                    {current.ocr?.applied && <> · OCR 적용</>}
                  </div>
                </div>
              </div>

              {/* Score bar — O/S/C 임계값 + 현재 score 위치 */}
              <ScoreBar score={c.score} sThreshold={c.thresholds.S} cThreshold={c.thresholds.C} />

              {showExplain && expl && (
                <div className="mt-3 pt-3 border-t border-current/20 text-xs leading-relaxed opacity-90">
                  {renderMarkdownBold(expl.narrative)}
                </div>
              )}
              <button
                onClick={() => setShowExplain(s => !s)}
                className="mt-2 text-xs opacity-70 hover:opacity-100 flex items-center gap-1"
              >
                <Eye className="w-3 h-3" /> {showExplain ? '간단히 보기' : '자세한 설명 보기'}
              </button>
            </section>

            {/* 3. Findings 요약 + 본문 하이라이트 */}
            <section className="border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Highlighter className="w-3 h-3 text-zinc-500" />
                <div className="text-xs font-semibold text-zinc-500 uppercase">탐지된 신호 (본문에서 강조)</div>
                {findingsBy.length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-auto">
                    {findingsBy.map(([et, n]) => (
                      <span key={et} className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-mono border border-red-200">
                        {et} <b>×{n}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {noPIIButGrade && (
                <div className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  ⚠ PII 엔티티가 0건인데 {c.grade} 등급입니다 — {noPIINoSignalReasonText}
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">PII</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">등급 키워드</span>
                <span className="text-zinc-400">— hover 시 상세 표시</span>
              </div>
              <pre
                className="bg-zinc-50 border rounded p-3 max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words font-mono leading-relaxed"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
              <div className="text-[10px] text-zinc-400 mt-1">
                {current.text.length.toLocaleString()} chars · 추출된 본문 일부 표시 (최대 4000자)
              </div>
            </section>

            {/* 3-A. 판정 근거 표 (기여도 큰 순) */}
            <details className="border rounded-lg bg-white" open>
              <summary className="cursor-pointer select-none p-3 text-xs font-semibold text-zinc-600 uppercase flex items-center gap-2 hover:bg-zinc-50">
                <ListTree className="w-3 h-3" />
                판정 근거 (기여도 큰 순)
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case">
                  {c.reasons.length}개 신호 · 합계 {c.score}점
                </span>
              </summary>
              <div className="px-3 pb-3 overflow-x-auto">
                {c.reasons.length === 0 ? (
                  <div className="text-xs text-zinc-400 py-3 text-center">기여 신호 없음</div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b">
                        <th className="py-1 pr-2 font-medium">종류</th>
                        <th className="py-1 pr-2 font-medium">신호</th>
                        <th className="py-1 pr-2 font-medium text-right">개수</th>
                        <th className="py-1 pr-2 font-medium text-right">가중치</th>
                        <th className="py-1 pr-2 font-medium text-right">기여도</th>
                        <th className="py-1 pl-2 font-medium w-32"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.reasons.map((r, i) => {
                        const maxContrib = Math.max(...c.reasons.map(x => x.contribution), 0.01);
                        const pct = Math.max(0, Math.min(100, (r.contribution / maxContrib) * 100));
                        const color = r.kind === 'entity'
                          ? 'bg-red-400'
                          : r.kind === 'keyword' ? 'bg-amber-400' : 'bg-blue-400';
                        return (
                          <tr key={`${r.kind}-${r.label}-${i}`} className="border-b last:border-b-0">
                            <td className="py-1 pr-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
                                {REASON_KIND_LABEL[r.kind] || r.kind}
                              </span>
                            </td>
                            <td className="py-1 pr-2 font-mono text-[11px] text-zinc-800">{r.label}</td>
                            <td className="py-1 pr-2 text-right tabular-nums">
                              {r.count}{r.counted !== undefined && r.counted !== r.count ? (
                                <span className="text-zinc-400 ml-1">→{r.counted}</span>
                              ) : null}
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums text-zinc-600">{r.weight}</td>
                            <td className="py-1 pr-2 text-right tabular-nums font-semibold">+{r.contribution}</td>
                            <td className="py-1 pl-2">
                              <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="text-[10px] text-zinc-400 mt-2">
                  count→ 표기는 컨텍스트 가중치 + log decay 적용 후 effective count.
                </div>
              </div>
            </details>

            {/* 3-B. 분류 모델 설명 */}
            <details className="border rounded-lg bg-white">
              <summary className="cursor-pointer select-none p-3 text-xs font-semibold text-zinc-600 uppercase flex items-center gap-2 hover:bg-zinc-50">
                <BookOpen className="w-3 h-3" />
                분류 모델 설명
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case font-mono">
                  {c.version}
                </span>
              </summary>
              <div className="px-3 pb-3 text-xs text-zinc-700 leading-relaxed space-y-2">
                <p>
                  <b>rule-v1.2</b> — 클라이언트 정규식·키워드 기반 score 분류기. 모든 분석은
                  브라우저 안에서 수행되며 본문은 PKIZIP 외부로 나가지 않습니다.
                </p>
                <ul className="list-disc list-inside space-y-1 text-zinc-600">
                  <li>
                    <b>점수</b> = Σ(엔티티 가중치 × 개수) + Σ(키워드 가중치 × log-decayed
                    effective count × 길이정규화)
                  </li>
                  <li>
                    <b>임계값</b> — 위험 C ≥ {c.thresholds.C} · 민감 S ≥ {c.thresholds.S} · 그
                    아래는 공개 O
                  </li>
                  <li>
                    <b>컨텍스트 가중치</b> — 부정문 / 표 헤더 / 라벨 정의 / 코드 블록 안 키워드는
                    0~0.4 로 감쇠
                  </li>
                  <li>
                    <b>키워드 단독 감쇠</b> — PII 엔티티 0건일 때 키워드 점수에 ×0.5 적용 (메타
                    문서 false positive 차단)
                  </li>
                  <li>
                    <b>비한국어 하한</b> — 한국어가 아니면 O 등급을 S 로 상향 (탐지 정확도 보정)
                  </li>
                  <li>
                    <b>NER 휴리스틱 필터</b> — 신경망 NER 의 PERSON / LOCATION / ORG 매치를
                    한국 성씨·조사·접두어 휴리스틱으로 후처리 (활성화 시)
                  </li>
                  <li>
                    <b>신뢰도</b> = 0.55 + 0.4 × tanh(margin/2) — 임계값에서 멀어질수록 ↑
                  </li>
                </ul>
                <p className="text-[11px] text-zinc-500 pt-1 border-t">
                  사용자가 "이 결정 저장" 으로 다른 등급을 선택하면 IndexedDB 에 기록되어 다음
                  학습 사이클의 가중치 보정에 사용됩니다 (오프라인, 외부 전송 없음).
                </p>
              </div>
            </details>

            {/* 3-C. 사용자 최종 분류 picker */}
            <section className="border rounded-lg p-3 bg-blue-50/30 border-blue-200">
              <div className="text-xs font-semibold text-zinc-600 uppercase mb-2 flex items-center gap-2">
                <UserCheck className="w-3 h-3 text-blue-600" />
                사용자 최종 분류
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case">
                  AI 결과를 검토하고 직접 등급을 지정할 수 있습니다
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {(['C', 'S', 'O'] as Grade[]).map(g => {
                  const active = userGrade === g;
                  const isAi = current.classification.grade === g;
                  return (
                    <button
                      key={g}
                      onClick={() => { setUserGrade(g); setUserManuallyPicked(true); setDecisionSaved(false); }}
                      className={`px-2 py-2 text-xs rounded border transition text-left ${
                        active
                          ? g === 'C' ? 'bg-red-600 text-white border-red-600'
                          : g === 'S' ? 'bg-amber-500 text-white border-amber-500'
                                       : 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white border-zinc-200 hover:border-blue-400'
                      }`}
                    >
                      <div className="font-bold text-base leading-tight">
                        {g} <span className="text-xs font-normal opacity-80">— {
                          g === 'C' ? '위험' : g === 'S' ? '민감' : '공개'
                        }</span>
                      </div>
                      {isAi && (
                        <div className={`text-[10px] mt-0.5 ${active ? 'opacity-90' : 'text-blue-600'}`}>
                          ✦ AI 추천
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={userMemo}
                onChange={e => { setUserMemo(e.target.value); setDecisionSaved(false); }}
                placeholder="결정 사유 (선택) — 예: 회사 외부 자료라 공개로 분류"
                rows={2}
                className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded resize-none focus:outline-none focus:border-blue-400"
              />
              <div className="mt-2 flex items-center gap-2">
                {userGradeGap > 0 ? (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    AI({current.classification.grade}) → 사용자({userGrade}) · gap {userGradeGap}단계
                  </span>
                ) : (
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    AI 결과에 동의 (gap 0)
                  </span>
                )}
                <button
                  onClick={handleSaveDecision}
                  disabled={savingDecision || decisionSaved}
                  className="ml-auto px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Save className="w-3 h-3" />
                  {decisionSaved ? '저장됨 ✓' : savingDecision ? '저장 중…' : '이 결정 저장'}
                </button>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1.5">
                IndexedDB 에 저장됩니다. 학습 사이클이 이 데이터를 사용해 가중치를 보정합니다.
              </div>
            </section>

            {/* 3-D. 전체 findings 표 */}
            <details className="border rounded-lg bg-white">
              <summary className="cursor-pointer select-none p-3 text-xs font-semibold text-zinc-600 uppercase flex items-center gap-2 hover:bg-zinc-50">
                <Table className="w-3 h-3" />
                전체 findings 표
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case">
                  {current.findings.length}건
                </span>
              </summary>
              <div className="px-3 pb-3 overflow-x-auto max-h-72 overflow-y-auto">
                {current.findings.length === 0 ? (
                  <div className="text-xs text-zinc-400 py-3 text-center">탐지된 PII 없음</div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-zinc-500 border-b">
                        <th className="py-1 pr-2 font-medium">#</th>
                        <th className="py-1 pr-2 font-medium">Entity</th>
                        <th className="py-1 pr-2 font-medium">매칭</th>
                        <th className="py-1 pr-2 font-medium text-right">Start</th>
                        <th className="py-1 pr-2 font-medium text-right">End</th>
                        <th className="py-1 pr-2 font-medium text-right">Score</th>
                        <th className="py-1 pr-2 font-medium">Recognizer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.findings.map((f, i) => (
                        <tr key={i} className="border-b last:border-b-0 hover:bg-zinc-50">
                          <td className="py-1 pr-2 text-zinc-400 tabular-nums">{i + 1}</td>
                          <td className="py-1 pr-2">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                              {f.entityType}
                            </span>
                          </td>
                          <td className="py-1 pr-2 font-mono text-[11px] max-w-[180px] truncate" title={f.text}>
                            {f.text}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-zinc-500">{f.start}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-zinc-500">{f.end}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{f.score.toFixed(2)}</td>
                          <td className="py-1 pr-2 text-[10px] text-zinc-500 font-mono truncate max-w-[120px]" title={f.recognizer || ''}>
                            {f.recognizer || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </details>

            {/* 3-E. 활성 인식기 패널 */}
            <details className="border rounded-lg bg-white">
              <summary className="cursor-pointer select-none p-3 text-xs font-semibold text-zinc-600 uppercase flex items-center gap-2 hover:bg-zinc-50">
                <Cpu className="w-3 h-3" />
                활성 인식기
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case">
                  정규식 {recognizers.filter(r => r.source !== 'denylist').length}개
                  · denylist {recognizers.filter(r => r.source === 'denylist').length}그룹
                  · NER {neuralPrefs.nerEnabled ? (nerStatus.loaded ? '활성' : '대기') : '비활성'}
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-3">
                {/* 정규식 + denylist 표 */}
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-zinc-500 border-b">
                        <th className="py-1 pr-2 font-medium">Entity</th>
                        <th className="py-1 pr-2 font-medium">출처</th>
                        <th className="py-1 pr-2 font-medium text-right">기본 score</th>
                        <th className="py-1 pr-2 font-medium">검증/항목</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recognizers.map((r, i) => (
                        <tr key={`${r.source}-${r.entityType}-${i}`} className="border-b last:border-b-0">
                          <td className="py-1 pr-2">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">
                              {r.entityType}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-[11px]">
                            <span className={
                              r.source === 'regex-kr' ? 'text-blue-700' :
                              r.source === 'regex-common' ? 'text-emerald-700' :
                              'text-purple-700'
                            }>
                              {r.source === 'regex-kr' ? '한국형 정규식' :
                               r.source === 'regex-common' ? '글로벌 정규식' : 'denylist'}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-zinc-600">{r.score.toFixed(2)}</td>
                          <td className="py-1 pr-2 text-[11px] text-zinc-500">
                            {r.hasValidator && <span className="text-emerald-600">✓ 검증</span>}
                            {r.termCount !== undefined && <span>{r.termCount}개 항목</span>}
                            {!r.hasValidator && r.termCount === undefined && <span className="text-zinc-400">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 신경망 NER 상태 */}
                <div className="border-t pt-2">
                  <div className="text-[11px] font-semibold text-zinc-600 mb-1.5 flex items-center gap-1.5">
                    <Cpu className="w-3 h-3" /> 신경망 NER (transformers.js · 클라이언트 추론)
                  </div>
                  {!neuralPrefs.nerEnabled ? (
                    <div className="text-xs text-zinc-500 bg-zinc-50 rounded px-2 py-1.5">
                      비활성 — 설정에서 옵트인 필요 (모델 ~280MB 다운로드)
                    </div>
                  ) : nerStatus.loaded ? (
                    <div className="text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                      <div className="font-mono text-emerald-700">{nerStatus.modelId}</div>
                      <div className="text-[10px] text-emerald-600 mt-0.5">
                        device <b>{nerStatus.device}</b> · minScore {neuralPrefs.nerMinScore}
                        · 휴리스틱 필터 적용 (한국 성씨/조사/접두어)
                      </div>
                    </div>
                  ) : nerStatus.loading ? (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      모델 로드 중…
                    </div>
                  ) : nerStatus.loadError ? (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                      로드 실패: {nerStatus.loadError}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500 bg-zinc-50 rounded px-2 py-1.5">
                      대기 — 첫 분석 시 모델 다운로드 (auto-load: {neuralPrefs.nerAutoLoad ? '켜짐' : '꺼짐'})
                    </div>
                  )}
                  {nerStatus.tried.length > 0 && (
                    <div className="text-[10px] text-zinc-400 mt-1">
                      후보 시도: {nerStatus.tried.map(t => `${t.model.split('/').pop()}${t.ok ? '✓' : '✗'}`).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </details>

            {/* 3-F. SHAP 토큰 기여도 */}
            <details className="border rounded-lg bg-white">
              <summary className="cursor-pointer select-none p-3 text-xs font-semibold text-zinc-600 uppercase flex items-center gap-2 hover:bg-zinc-50">
                <Zap className="w-3 h-3 text-purple-600" />
                SHAP 토큰 기여도
                <span className="ml-auto text-[10px] font-normal text-zinc-400 normal-case">
                  {shapResult
                    ? `${shapResult.evaluated} 토큰 · ${shapResult.elapsedMs}ms · maxΔ ${shapResult.maxAbsDelta}`
                    : 'occlusion 기반 (Python SHAP 5-30s → ~수백 ms)'}
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-3">
                {!shapResult && !shapRunning && (
                  <div className="bg-purple-50 border border-purple-200 rounded p-3 text-xs space-y-1.5">
                    <div className="text-purple-900 font-semibold">토큰별 기여도 분석</div>
                    <div className="text-purple-700 leading-relaxed">
                      본문의 각 토큰을 같은 길이 공백으로 마스킹 후 재분류 →
                      score 변화를 측정합니다. 룰 기반 분류기에서는 SHAP 와 거의
                      동일한 결과를 ~200토큰 기준 수백 ms 안에 얻을 수 있습니다.
                    </div>
                    <button
                      onClick={runShap}
                      className="mt-1 px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-1.5"
                    >
                      <Zap className="w-3 h-3" /> 분석 실행
                    </button>
                  </div>
                )}

                {shapRunning && (
                  <div className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-3 py-2 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    토큰 마스킹 + 재분류 진행 중…
                  </div>
                )}

                {shapResult && (
                  <>
                    {/* 통계 헤더 */}
                    <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                      <span className="font-mono">{shapResult.method}</span>
                      <span>·</span>
                      <span>총 {shapResult.totalTokens} 토큰 중 {shapResult.evaluated} 평가</span>
                      <span>·</span>
                      <span>유효 기여 {shapResult.tokens.length}개</span>
                      <button
                        onClick={runShap}
                        className="ml-auto text-[10px] text-purple-600 hover:text-purple-800 underline"
                      >
                        다시 실행
                      </button>
                    </div>

                    {/* 범례 */}
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: 'rgba(239,68,68,0.4)', color: '#7f1d1d' }}>
                        + 등급 상승 기여
                      </span>
                      <span className="px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: 'rgba(16,185,129,0.4)', color: '#064e3b' }}>
                        − 등급 하락 기여
                      </span>
                      <span className="text-zinc-400 ml-auto">색상 농도 = |기여도|</span>
                    </div>

                    {/* 본문 + 기여도 색칠 */}
                    <pre
                      className="bg-zinc-50 border rounded p-3 max-h-72 overflow-auto text-xs whitespace-pre-wrap break-words font-mono leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: buildAttributionHtml(current.text, shapResult, 4000),
                      }}
                    />

                    {/* Top-10 토큰 표 */}
                    {shapResult.tokens.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-900">
                          ▸ Top {Math.min(10, shapResult.tokens.length)} 토큰 (|기여도| 큰 순)
                        </summary>
                        <table className="w-full text-xs mt-2">
                          <thead>
                            <tr className="text-left text-zinc-500 border-b">
                              <th className="py-1 pr-2 font-medium">토큰</th>
                              <th className="py-1 pr-2 font-medium text-right">scoreΔ</th>
                              <th className="py-1 pr-2 font-medium text-right">정규화</th>
                              <th className="py-1 pr-2 font-medium">등급 변화</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...shapResult.tokens]
                              .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
                              .slice(0, 10)
                              .map((t, i) => (
                                <tr key={i} className="border-b last:border-b-0">
                                  <td className="py-1 pr-2 font-mono text-[11px] max-w-[180px] truncate" title={t.token}>
                                    {t.token}
                                  </td>
                                  <td className={`py-1 pr-2 text-right tabular-nums font-semibold ${
                                    t.scoreDelta > 0 ? 'text-red-600' : 'text-emerald-600'
                                  }`}>
                                    {t.scoreDelta > 0 ? '+' : ''}{t.scoreDelta.toFixed(2)}
                                  </td>
                                  <td className="py-1 pr-2 text-right tabular-nums text-zinc-500">
                                    {t.fraction.toFixed(2)}
                                  </td>
                                  <td className="py-1 pr-2 text-[11px]">
                                    {t.flipsGrade ? (
                                      <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                        마스킹 시 {t.flipsGrade} 로 변경
                                      </span>
                                    ) : <span className="text-zinc-400">—</span>}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                  </>
                )}
              </div>
            </details>

            {/* 4. 가명/익명화 */}
            <section className="border rounded-lg p-3">
              <div className="text-xs font-semibold text-zinc-500 uppercase mb-2 flex items-center gap-2">
                <Sparkles className="w-3 h-3" /> 가명/익명화
              </div>
              <div className="text-xs text-zinc-600 mb-2">
                {c.grade === 'O'
                  ? 'O 등급 — 가명처리 불필요. 그대로 송신 가능.'
                  : `${c.grade} 등급 — 가명처리하면 등급이 ${anonPrefs.targetGrade} 등급까지 낮아질 수 있습니다.`}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ActionButton active={anonAction === 'pseudonymize'}
                  onClick={() => { setAnonAction('pseudonymize'); runAnonymization('pseudonymize'); }}>
                  🎭 가명처리 (복원 가능)
                </ActionButton>
                <ActionButton active={anonAction === 'anonymize'}
                  onClick={() => { setAnonAction('anonymize'); runAnonymization('anonymize'); }}>
                  🔒 익명화 (비가역)
                </ActionButton>
                <ActionButton active={anonAction === 'skip'}
                  onClick={() => setAnonAction('skip')}>
                  ⏭ 적용 안 함
                </ActionButton>
              </div>

              {current.anonymization && (
                <div className="mt-3 text-xs space-y-1 bg-zinc-50 rounded p-2">
                  <div>
                    적용 전 → 후 등급:
                    <b className="ml-1">{current.anonymization.iterations[0]?.grade}</b>
                    {' → '}
                    <b className={c.grade === 'O' ? 'text-emerald-600' : 'text-amber-600'}>
                      {current.anonymization.finalGrade}
                    </b>
                    {' '}(반복 {current.anonymization.iterations.length - 1}회)
                  </div>
                  <div>
                    변경 {current.anonymization.result.replacements.length}건
                    · 가역성:{' '}
                    <b>{current.anonymization.result.isReversible ? '가명처리' : '익명화'}</b>
                    {' '}(매핑 {Object.keys(current.anonymization.result.mapping).length}개)
                  </div>
                </div>
              )}
            </section>

            {/* 5. 정책 결정 */}
            {policy && (
              <section className={`border rounded-lg p-3 ${policy.allow ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className="text-xs font-semibold uppercase mb-2 flex items-center gap-2">
                  {policy.allow ? (
                    <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> <span className="text-emerald-700">정책 통과</span></>
                  ) : (
                    <><AlertTriangle className="w-3 h-3 text-red-600" /> <span className="text-red-700">정책 위반 — 송신 불가</span></>
                  )}
                  <span className="ml-auto text-zinc-400 font-normal text-[10px]">{policy.engine}</span>
                </div>
                {policy.denyReasons.length > 0 && (
                  <ul className="text-xs space-y-1 mb-2">
                    {policy.denyReasons.map(r => (
                      <li key={r} className="text-red-700">• {REASON_MESSAGES[r] || r}</li>
                    ))}
                  </ul>
                )}
                {policy.recommendedActions.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {policy.recommendedActions.map(a => (
                      <li key={a} className="text-zinc-700">💡 {ACTION_MESSAGES[a] || a}</li>
                    ))}
                  </ul>
                )}
                {policy.requireWatermark && <div className="text-xs text-amber-700 mt-1">⚠ 워터마크 강제</div>}
                {policy.requirePqc && <div className="text-xs text-amber-700">⚠ PQC 암호화 필요</div>}
              </section>
            )}

            {/* 6. 디폴트 저장 */}
            <section className="text-xs">
              <label className="flex items-center gap-2 text-zinc-600">
                <input type="checkbox" checked={rememberDefaults}
                  onChange={e => setRememberDefaults(e.target.checked)} />
                다음에도 같은 옵션 사용 (사용 의도 + 가명처리 디폴트 저장)
              </label>
            </section>
          </div>

          {/* 푸터 */}
          <div className="flex justify-end gap-2 p-4 border-t bg-zinc-50">
            <button onClick={onClose} className="px-3 py-2 text-sm hover:bg-zinc-100 rounded">취소</button>
            <button
              onClick={handleAccept}
              disabled={!policy?.allow}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:bg-zinc-300 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Shield className="w-4 h-4" />
              {policy?.allow ? '이 결과로 봉투 만들기' : '정책 위반으로 차단됨'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Score bar — O(0~S) / S(S~C) / C(C~) 그라데이션 + 임계 마커 + 현재 score 위치.
 * HE-TEST 의 그라데이션 게이지 동등.
 */
function ScoreBar({ score, sThreshold, cThreshold }: {
  score: number; sThreshold: number; cThreshold: number;
}) {
  // 표시 범위 — score 가 cThreshold 보다 높으면 그만큼 늘림
  const max = Math.max(cThreshold * 1.5, score * 1.1, cThreshold + 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const sPct = pct(sThreshold);
  const cPct = pct(cThreshold);
  const scorePct = pct(score);

  return (
    <div className="mt-3 pt-3 border-t border-current/10">
      <div className="relative h-3 rounded-full overflow-hidden"
        style={{
          background: `linear-gradient(to right,
            #10b981 0%, #10b981 ${sPct}%,
            #f59e0b ${sPct}%, #f59e0b ${cPct}%,
            #ef4444 ${cPct}%, #ef4444 100%)`,
        }}
      >
        {/* 현재 score 마커 */}
        <div
          className="absolute top-0 h-full w-0.5 bg-zinc-900 shadow"
          style={{ left: `calc(${scorePct}% - 1px)` }}
        />
      </div>
      <div className="relative h-4 mt-1 text-[10px] text-current/70">
        <span style={{ position: 'absolute', left: '0%' }}>0</span>
        <span style={{ position: 'absolute', left: `${sPct}%`, transform: 'translateX(-50%)' }}>
          S={sThreshold}
        </span>
        <span style={{ position: 'absolute', left: `${cPct}%`, transform: 'translateX(-50%)' }}>
          C={cThreshold}
        </span>
        <span
          className="font-bold"
          style={{ position: 'absolute', left: `${scorePct}%`, transform: 'translateX(-50%)' }}
        >
          ▲ {score}
        </span>
      </div>
    </div>
  );
}

/** 타임스탬프 → "MM-DD HH:MM" 한국 시각 */
function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ActionButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-2 text-xs rounded border transition ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white border-zinc-200 hover:border-blue-400'
      }`}
    >
      {children}
    </button>
  );
}

function renderMarkdownBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <b key={i}>{p.slice(2, -2)}</b>
      : <span key={i}>{p}</span>
  );
}

/**
 * 본문 + findings + 키워드 → HTML (mark 태그로 강조).
 * - PII findings: 빨강 mark, title=entityType
 * - 등급 키워드: 노랑 mark, title=label (가중치)
 * - 길이 4000자 초과 시 자른 후 "..." 표시
 */
function buildHighlight(
  text: string,
  findings: Array<{ start: number; end: number; entityType: string }>,
  keywords: Array<{ start: number; end: number; keyword: string; label: string; weight: number }>,
  maxChars = 4000,
): string {
  if (!text) return '<span class="text-zinc-400">본문 없음</span>';
  const truncated = text.length > maxChars;
  const sliced = truncated ? text.slice(0, maxChars) : text;

  type Marker = { start: number; end: number; kind: 'pii' | 'kw'; title: string };
  const markers: Marker[] = [];
  for (const f of findings) {
    if (f.start >= sliced.length) continue;
    markers.push({
      start: f.start,
      end: Math.min(f.end, sliced.length),
      kind: 'pii',
      title: f.entityType,
    });
  }
  for (const k of keywords) {
    if (k.start >= sliced.length) continue;
    markers.push({
      start: k.start,
      end: Math.min(k.end, sliced.length),
      kind: 'kw',
      title: `등급 키워드: ${k.label} (+${k.weight})`,
    });
  }
  // 시작순 정렬 + 겹침 제거 (먼저 매칭된 것 우선)
  markers.sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Marker[] = [];
  let lastEnd = -1;
  for (const m of markers) {
    if (m.start < lastEnd) continue;
    placed.push(m);
    lastEnd = m.end;
  }

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let out = '', cur = 0;
  for (const m of placed) {
    out += escape(sliced.slice(cur, m.start));
    const cls = m.kind === 'pii'
      ? 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:0 2px;border-radius:3px;font-weight:600'
      : 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:0 2px;border-radius:3px;font-weight:600';
    out += `<mark style="${cls}" title="${escape(m.title)}">${escape(sliced.slice(m.start, m.end))}</mark>`;
    cur = m.end;
  }
  out += escape(sliced.slice(cur));
  if (truncated) out += '<span style="color:#9ca3af">…(잘림)</span>';
  return out;
}

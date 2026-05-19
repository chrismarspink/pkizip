/**
 * Partition Tree SHAP — HE-TEST `shap_explain.py` 의 PartitionExplainer 클라이언트 포팅.
 *
 * 기존 shap-attribution.ts 는 token 단위 occlusion (단순) — 인접 토큰 그룹의
 * 시너지 (예: "주민등록번호 850506-1234567" 두 토큰이 함께 있어야 의미) 를
 * 포착 못함. Partition tree 는 토큰을 계층적으로 묶어 그룹 단위 occlusion 으로
 * 더 안정적인 기여도 산출.
 *
 * 알고리즘:
 *   1) 토큰 N개 → 이진 트리 (병합) — 인접 토큰부터 묶음
 *   2) 각 노드 = 그 노드의 모든 leaf 토큰을 동시에 마스킹
 *   3) Shapley value 추정 — 노드의 부모 vs 자식 차이로 기여도 분해
 *   4) leaf token 의 최종 score = 모든 조상 노드 기여도 합
 *
 * 본 구현은 KernelSHAP partition 의 단순화 버전:
 *   - 완전한 Shapley 가중치 (모든 부분집합 평균) 대신
 *     이진 partition tree 단위 분해 → O(N) 평가
 */
import { classify } from './classifier';
import { detect } from './pii-detector';
import type { Classification, Grade } from './types';

export interface PartitionAttribution {
  token: string;
  start: number;
  end: number;
  /** 해당 토큰이 속한 그룹 노드들의 누적 기여도 합 */
  scoreDelta: number;
  /** -1..1, maxAbs 로 정규화 */
  fraction: number;
  /** 토큰이 단독 occlusion 대비 그룹 occlusion 으로 추가 검출된 기여 */
  groupBonus: number;
}

export interface PartitionTreeNode {
  /** leaf token indices (inclusive range) */
  leftIdx: number;
  rightIdx: number;
  /** 이 노드의 토큰들을 모두 마스킹했을 때 score */
  maskedScore: number;
  /** baseScore - maskedScore */
  contribution: number;
  /** 자식 (leaf 면 null) */
  left?: PartitionTreeNode;
  right?: PartitionTreeNode;
}

export interface PartitionResult {
  tokens: PartitionAttribution[];
  tree: PartitionTreeNode;
  baseScore: number;
  baseGrade: Grade;
  maxAbsDelta: number;
  totalTokens: number;
  evaluated: number;
  elapsedMs: number;
  method: 'partition-tree-v1';
  version: string;
}

const VERSION = 'partition-v1';

interface TokenSpan { text: string; start: number; end: number }

function tokenize(text: string, maxTokens: number): TokenSpan[] {
  const re = /\S+/g;
  const out: TokenSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (out.length <= maxTokens) return out;
  const step = out.length / maxTokens;
  const sampled: TokenSpan[] = [];
  for (let i = 0; i < maxTokens; i++) {
    sampled.push(out[Math.floor(i * step)]!);
  }
  return sampled;
}

function maskRange(text: string, tokens: TokenSpan[], leftIdx: number, rightIdx: number): string {
  // tokens[leftIdx..rightIdx] 를 공백으로 치환
  let masked = text;
  for (let i = leftIdx; i <= rightIdx; i++) {
    const t = tokens[i];
    masked = masked.substring(0, t.start) +
             ' '.repeat(t.text.length) +
             masked.substring(t.end);
  }
  return masked;
}

/**
 * 인접 토큰을 이진 트리로 병합. midpoint 분할.
 * 평가 횟수: 노드 수 ≈ 2N-1.
 */
function buildPartitionTree(
  text: string,
  tokens: TokenSpan[],
  baseScore: number,
  leftIdx: number,
  rightIdx: number,
  evalCounter: { n: number }
): PartitionTreeNode {
  const maskedText = maskRange(text, tokens, leftIdx, rightIdx);
  const findings = detect(maskedText);
  const cls = classify(findings, maskedText);
  evalCounter.n += 1;
  const node: PartitionTreeNode = {
    leftIdx, rightIdx,
    maskedScore: cls.score,
    contribution: Math.round((baseScore - cls.score) * 1000) / 1000,
  };
  if (leftIdx < rightIdx) {
    const mid = Math.floor((leftIdx + rightIdx) / 2);
    node.left  = buildPartitionTree(text, tokens, baseScore, leftIdx, mid, evalCounter);
    node.right = buildPartitionTree(text, tokens, baseScore, mid + 1, rightIdx, evalCounter);
  }
  return node;
}

/**
 * leaf 토큰의 최종 기여도 = 그 leaf 를 포함하는 모든 조상 노드의 (자식 기여도 - 자기 기여도)
 * 단순화: 자기 노드의 contribution 만 사용 (Partition Tree Shapley 의 1-차 근사).
 */
function collectLeafContributions(
  node: PartitionTreeNode,
  tokens: TokenSpan[],
  out: Map<number, { delta: number; group: number }>
): void {
  // leaf node — 단독 마스킹 기여도
  if (!node.left && !node.right) {
    out.set(node.leftIdx, { delta: node.contribution, group: 0 });
    return;
  }
  // 내부 노드 — 자식 합 vs 자기 = group bonus (시너지)
  const leftSize = node.left ? (node.left.rightIdx - node.left.leftIdx + 1) : 0;
  const rightSize = node.right ? (node.right.rightIdx - node.right.leftIdx + 1) : 0;
  const groupSize = leftSize + rightSize;
  const childContribSum = (node.left?.contribution ?? 0) + (node.right?.contribution ?? 0);
  const synergy = node.contribution - childContribSum;  // 양수면 시너지 있음
  // 자식 leaf 들에 synergy 를 균등 분배 (간단)
  if (node.left)  collectLeafContributions(node.left, tokens, out);
  if (node.right) collectLeafContributions(node.right, tokens, out);
  for (let i = node.leftIdx; i <= node.rightIdx; i++) {
    const cur = out.get(i) || { delta: 0, group: 0 };
    cur.group += synergy / groupSize;
    out.set(i, cur);
  }
}

/**
 * Partition Tree 기반 SHAP 기여도 계산.
 *
 * @param opts.maxTokens — 분석할 최대 토큰 (이진 트리라 평가 ≈ 2N)
 *                         기본 64 (≈128 평가, ~수백 ms)
 */
export function computePartitionAttributions(
  text: string,
  baseClassification: Classification,
  opts: { maxTokens?: number } = {}
): PartitionResult {
  const t0 = performance.now();
  const { maxTokens = 64 } = opts;
  const tokens = tokenize(text, maxTokens);
  const totalTokens = tokens.length;

  if (totalTokens === 0) {
    return {
      tokens: [], tree: { leftIdx: 0, rightIdx: -1, maskedScore: 0, contribution: 0 },
      baseScore: baseClassification.score, baseGrade: baseClassification.grade,
      maxAbsDelta: 0, totalTokens: 0, evaluated: 0,
      elapsedMs: 0, method: 'partition-tree-v1', version: VERSION,
    };
  }

  const baseScore = baseClassification.score;
  const evalCounter = { n: 0 };
  const tree = buildPartitionTree(text, tokens, baseScore, 0, totalTokens - 1, evalCounter);

  // leaf 별 기여도 집계
  const leafMap = new Map<number, { delta: number; group: number }>();
  collectLeafContributions(tree, tokens, leafMap);

  let maxAbs = 0;
  const attrs: PartitionAttribution[] = tokens.map((t, i) => {
    const m = leafMap.get(i) || { delta: 0, group: 0 };
    const total = m.delta + m.group;
    if (Math.abs(total) > maxAbs) maxAbs = Math.abs(total);
    return {
      token: t.text, start: t.start, end: t.end,
      scoreDelta: Math.round(total * 1000) / 1000,
      fraction: 0,  // 다음 패스
      groupBonus: Math.round(m.group * 1000) / 1000,
    };
  });
  for (const a of attrs) {
    a.fraction = maxAbs > 0 ? Math.round((a.scoreDelta / maxAbs) * 1000) / 1000 : 0;
  }

  return {
    tokens: attrs, tree,
    baseScore, baseGrade: baseClassification.grade,
    maxAbsDelta: Math.round(maxAbs * 1000) / 1000,
    totalTokens, evaluated: evalCounter.n,
    elapsedMs: Math.round((performance.now() - t0) * 100) / 100,
    method: 'partition-tree-v1', version: VERSION,
  };
}

/** 단위 테스트용. */
export function _testPartitionTokens(
  text: string,
  baseClassification: Classification,
  maxTokens = 32
): PartitionResult {
  return computePartitionAttributions(text, baseClassification, { maxTokens });
}

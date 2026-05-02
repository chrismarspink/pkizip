/**
 * 자연어 설명 — HE-TEST explainer.py 클라이언트 포팅.
 *
 * 분류기의 structured reasons → 사람이 읽을 수 있는 자연어 설명.
 * LLM 호출 없는 템플릿 + 분기 합성.
 */
import type { Classification, Finding, Grade } from './types';

export const EXPLAINER_VERSION = 'rule-explainer-v1';

const ENTITY_NAMES: Record<string, string> = {
  KR_RRN: '주민등록번호', KR_PASSPORT: '여권번호', KR_BIZ_NO: '사업자등록번호',
  KR_PHONE: '한국 전화번호', KR_ADDRESS: '한국 주소',
  KR_ARC: '외국인등록번호', KR_DRIVERS_LICENSE: '운전면허번호',
  KR_HEALTH_INSURANCE: '건강보험증 번호', KR_CAR_PLATE: '차량번호',
  KR_CORP_REG_NUMBER: '법인등록번호',
  PHONE_NUMBER: '전화번호', CREDIT_CARD: '신용카드번호',
  AWS_ACCESS_KEY: 'AWS 액세스 키', GENERIC_API_KEY: 'API 키 추정 토큰',
  VIP_NAMES: 'VIP 명단', INTERNAL_PROJECTS: '내부 프로젝트명',
  EMAIL_ADDRESS: '이메일', IP_ADDRESS: 'IP 주소',
  PERSON: '인명', LOCATION: '지명', ORGANIZATION: '조직명',
};

const GRADE_LABEL: Record<Grade, string> = {
  C: '**위험 (Critical)**',
  S: '**민감 (Sensitive)**',
  O: '**공개 (Open)**',
};

export function explain(c: Classification, _findings: Finding[] = []): {
  summary: string;
  narrative: string;
  bullets: string[];
  version: string;
} {
  const grade = c.grade;
  const score = c.score;
  const conf = c.confidence;
  const th = c.thresholds;
  const reasons = c.reasons || [];

  const summary = `${GRADE_LABEL[grade]} — score ${score} (신뢰도 ${(conf * 100).toFixed(0)}%)`;

  const parts: string[] = [];

  // 1) 등급 결정 사유
  if (grade === 'C') {
    const margin = score - th.C;
    parts.push(`이 문서는 ${GRADE_LABEL[grade]} 등급으로 분류됩니다 — 누적 점수 ${score} 가 C 임계값 ${th.C} 를 ${margin.toFixed(2)}점 초과했습니다.`);
  } else if (grade === 'S') {
    parts.push(`이 문서는 ${GRADE_LABEL[grade]} 등급으로 분류됩니다 — 점수 ${score} 가 S 임계값 ${th.S} 와 C 임계값 ${th.C} 사이에 위치합니다.`);
  } else {
    parts.push(`이 문서는 ${GRADE_LABEL[grade]} 등급으로 분류됩니다 — 점수 ${score} 가 S 임계값 ${th.S} 미만으로, 등급을 올릴 만한 신호가 부족합니다.`);
  }

  // 2) 결정적 신호 Top 3
  const top = reasons.slice(0, 3);
  if (top.length > 0) {
    const phrases = top.map(r => {
      if (r.kind === 'keyword') return `등급 라벨 '${r.label}' ${r.count}회 (+${r.contribution.toFixed(2)}점)`;
      if (r.kind === 'language') return `${r.label} 언어 하한 (+${r.contribution.toFixed(2)}점)`;
      const desc = ENTITY_NAMES[r.label] || r.label;
      return r.count > 1
        ? `${desc} ${r.count}건 (+${r.contribution.toFixed(2)}점)`
        : `${desc} (+${r.contribution.toFixed(2)}점)`;
    });
    parts.push('결정적이었던 신호: ' + phrases.join(', ') + '.');
  } else {
    parts.push('매칭된 신호가 없어 점수가 0에 가깝습니다.');
  }

  // 3) 신호 구성
  const entityReasons = reasons.filter(r => r.kind === 'entity');
  const kwReasons = reasons.filter(r => r.kind === 'keyword');
  if (kwReasons.length > 0 && entityReasons.length > 0) {
    parts.push(`등급 라벨 키워드 ${kwReasons.length}종과 식별자 ${entityReasons.length}종이 함께 매칭되어 등급이 더 안정적으로 결정되었습니다.`);
  } else if (kwReasons.length > 0) {
    parts.push("본문에 명시된 등급 라벨(예: 대외비/기밀)만으로 결정되었습니다 — 실제 식별자가 없을 수도 있으니 사용자 검토를 권장합니다.");
  } else if (entityReasons.length > 0 && grade === 'C') {
    parts.push("등급 라벨 키워드 없이 식별자 검출만으로 위험 등급이 확정되었습니다.");
  }

  // 4) 고위험 식별자 강조
  const pHigh = entityReasons.filter(r => r.contribution >= 2.0);
  if (pHigh.length > 0) {
    const names = pHigh.map(r => ENTITY_NAMES[r.label] || r.label).join(', ');
    parts.push(`고위험 식별자: ${names}.`);
  }

  // 5) 신뢰도 코멘트
  if (conf < 0.62) {
    parts.push(`⚠ 신뢰도 ${(conf * 100).toFixed(0)}% — 임계값 경계에 가까워 사용자 최종 확인을 권장합니다.`);
  } else if (conf > 0.85) {
    parts.push(`신뢰도 ${(conf * 100).toFixed(0)}% — 등급 경계에서 충분히 떨어진 명확한 매칭.`);
  }

  const narrative = parts.join(' ');

  // bullets
  const bullets: string[] = [];
  for (const r of top) {
    if (r.kind === 'keyword') {
      bullets.push(`등급 라벨 '${r.label}' ${r.count}회 (+${r.contribution})`);
    } else if (r.kind === 'language') {
      bullets.push(`${r.label} 언어 하한 (+${r.contribution})`);
    } else {
      const d = ENTITY_NAMES[r.label] || r.label;
      bullets.push(r.count > 1 ? `${d} ${r.count}건 (+${r.contribution})` : `${d} (+${r.contribution})`);
    }
  }
  bullets.push(`점수 ${score} (S≥${th.S} · C≥${th.C})`);
  bullets.push(`신뢰도 ${(conf * 100).toFixed(0)}%`);
  if (entityReasons.length === 0 && kwReasons.length === 0) bullets.push('매칭된 신호 없음 — 기본값(O)');

  return { summary, narrative, bullets, version: EXPLAINER_VERSION };
}

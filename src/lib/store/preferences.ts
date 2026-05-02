/**
 * 사용자 개인 디폴트 — 로컬 우선 (localStorage).
 *
 * 사용자가 첫 분석 시 선택한 워크플로 옵션(보관 위치 / 암호 방식 / 가명처리 등)을
 * 저장해두고 다음번부터 자동 적용. Step 5의 "디폴트 기억" 요건.
 *
 * 키 분리:
 *   pkizip.prefs.workflow      — 의도 (purpose / cryptoKind)
 *   pkizip.prefs.anonymization — 가명처리 정책 디폴트
 *   pkizip.prefs.policy        — OPA 정책 디폴트
 *   pkizip.prefs.explorer      — 탐색기 UI 디폴트
 */

const KEY_PREFIX = 'pkizip.prefs.';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type Purpose    = 'internal' | 'external';
export type CryptoKind = 'classic' | 'hybrid' | 'pqc-only' | 'pqc-he';

export interface WorkflowPrefs {
  purpose: Purpose;
  cryptoKind: CryptoKind;
  /** O 등급도 항상 ML-DSA 서명 강제 */
  signOEnvelope: boolean;
  /** 분석 다이얼로그 자동 표시 (false면 사용자가 명시적으로 선택해야 함) */
  autoAnalyze: boolean;
}

export interface AnonymizationPrefs {
  /** 분석 후 자동으로 가명처리 다이얼로그 표시 */
  autoSuggest: boolean;
  /** 사용자가 매번 결정한 디폴트 */
  defaultAction: 'pseudonymize' | 'anonymize' | 'skip';
  /** 도달 목표 등급 */
  targetGrade: 'O' | 'S';
  /** 매핑 테이블 동봉 정책 */
  mappingTablePolicy: {
    include: boolean;
    sealAlgorithm: CryptoKind;          // 매핑 테이블 봉인 시 사용할 알고리즘
  };
  /** 마지막 사용된 anonymization_policy.json 버전 */
  lastPolicyVersion?: string;
}

export interface PolicyPrefs {
  /** OPA 강제 — false 시 정책 평가만 하고 차단 안 함 (시연용) */
  enforce: boolean;
  /** 정책 위반 시 사용자에게 이유 표시 */
  showReason: boolean;
}

export interface NeuralPrefs {
  /** 신경망 NER 사용 (transformers.js 클라이언트 추론) — opt-in */
  nerEnabled: boolean;
  /** 첫 분석 시 자동 다운로드/로드 (false 면 사용자가 수동 클릭) */
  nerAutoLoad: boolean;
  /** NER finding minScore */
  nerMinScore: number;
}

export const DEFAULT_NEURAL: NeuralPrefs = {
  nerEnabled: false,
  nerAutoLoad: false,
  nerMinScore: 0.7,
};

export interface ExplorerPrefs {
  layout: 'grid' | 'list';
  /** 카드 크기 */
  cardSize: 'sm' | 'md' | 'lg';
  /** 등급 필터 */
  filterGrade?: 'C' | 'S' | 'O' | 'all';
  /** 정렬 */
  sortBy: 'date' | 'name' | 'grade' | 'size';
  sortDir: 'asc' | 'desc';
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

export const DEFAULT_WORKFLOW: WorkflowPrefs = {
  purpose: 'external',
  cryptoKind: 'hybrid',
  signOEnvelope: true,
  autoAnalyze: true,
};

export const DEFAULT_ANON: AnonymizationPrefs = {
  autoSuggest: true,
  defaultAction: 'pseudonymize',
  targetGrade: 'O',
  mappingTablePolicy: {
    include: true,
    sealAlgorithm: 'hybrid',
  },
};

export const DEFAULT_POLICY: PolicyPrefs = {
  enforce: true,
  showReason: true,
};

export const DEFAULT_EXPLORER: ExplorerPrefs = {
  layout: 'grid',
  cardSize: 'md',
  sortBy: 'date',
  sortDir: 'desc',
};

// ─────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export const prefs = {
  workflow: {
    get(): WorkflowPrefs { return load('workflow', DEFAULT_WORKFLOW); },
    set(p: Partial<WorkflowPrefs>): WorkflowPrefs {
      const cur = { ...this.get(), ...p };
      save('workflow', cur);
      return cur;
    },
    reset(): WorkflowPrefs {
      save('workflow', DEFAULT_WORKFLOW);
      return { ...DEFAULT_WORKFLOW };
    },
  },
  anon: {
    get(): AnonymizationPrefs { return load('anonymization', DEFAULT_ANON); },
    set(p: Partial<AnonymizationPrefs>): AnonymizationPrefs {
      const cur = { ...this.get(), ...p };
      save('anonymization', cur);
      return cur;
    },
  },
  policy: {
    get(): PolicyPrefs { return load('policy', DEFAULT_POLICY); },
    set(p: Partial<PolicyPrefs>): PolicyPrefs {
      const cur = { ...this.get(), ...p };
      save('policy', cur);
      return cur;
    },
  },
  explorer: {
    get(): ExplorerPrefs { return load('explorer', DEFAULT_EXPLORER); },
    set(p: Partial<ExplorerPrefs>): ExplorerPrefs {
      const cur = { ...this.get(), ...p };
      save('explorer', cur);
      return cur;
    },
  },
  neural: {
    get(): NeuralPrefs { return load('neural', DEFAULT_NEURAL); },
    set(p: Partial<NeuralPrefs>): NeuralPrefs {
      const cur = { ...this.get(), ...p };
      save('neural', cur);
      return cur;
    },
  },
  /** 모든 디폴트 초기화 (디버그용) */
  resetAll(): void {
    for (const k of ['workflow', 'anonymization', 'policy', 'explorer']) {
      try { localStorage.removeItem(KEY_PREFIX + k); } catch { /* ignore */ }
    }
  },
};

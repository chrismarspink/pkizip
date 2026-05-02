/**
 * 동형암호 엔진 — 백엔드 독립 인터페이스.
 *
 * 사용자 명세:
 *   - 동형암호는 node-seal 사용 (현재)
 *   - 나중에 openFHE 도입 가능하도록 추상화
 *   - 검색키는 옵션으로 CMS 봉투에 동봉
 *
 * 인터페이스를 추상화 → node-seal 어댑터 + openFHE 자리 표시.
 * 사용처는 항상 HEEngine 인터페이스만 의존.
 */

export type HeScheme = 'BFV' | 'CKKS' | 'BGV';

export interface HEContextParams {
  scheme: HeScheme;
  /** poly_modulus_degree — 4096 (성능) / 8192 (depth>1) / 16384 (정확도) */
  polyModulusDegree: number;
  /** plain_modulus (BFV/BGV) */
  plainModulus?: number;
}

export interface HEKeyBundle {
  publicKey: string;       // base64
  secretKey?: string;      // base64 — 송신자만 보유 (옵션)
  relinKey?: string;       // base64 — 곱셈 후 차원 축소
  galoisKey?: string;      // base64 — 슬롯 회전
}

export interface HESearchIndex {
  /** 인덱싱된 토큰 수 */
  tokenCount: number;
  /** Base64 직렬화된 암호문 (여러 개 합친) */
  ciphertext: string;
  /** Encryption parameters (모든 ct 공통) */
  params: HEContextParams;
  /** 공개키 — 수신자가 검색하려면 필요 */
  publicKey: string;
  /** 알고리즘 식별자 — engine 종류 + 버전 */
  engine: HEEngineKind;
}

export type HEEngineKind = 'node-seal@5' | 'openfhe@1';

/**
 * HE 엔진 인터페이스 — 모든 백엔드가 구현.
 */
export interface HEEngine {
  readonly kind: HEEngineKind;
  init(params: HEContextParams): Promise<void>;
  generateKeys(): Promise<HEKeyBundle>;
  /** 키워드 토큰 리스트 → 단일 인덱스 암호문 */
  encryptTokens(tokens: string[]): Promise<HESearchIndex>;
  /** 인덱스 + 검색어 → 매치 여부 */
  search(index: HESearchIndex, query: string): Promise<boolean>;
  dispose(): void;
}

// ─────────────────────────────────────────────
// node-seal 어댑터 (현재 백엔드)
// ─────────────────────────────────────────────

class NodeSealEngine implements HEEngine {
  readonly kind: HEEngineKind = 'node-seal@5';
  private seal: any = null;
  private context: any = null;
  private params: HEContextParams = { scheme: 'BFV', polyModulusDegree: 4096 };
  private publicKey: any = null;
  private secretKey: any = null;
  private encryptor: any = null;
  private decryptor: any = null;
  private encoder: any = null;

  async init(params: HEContextParams): Promise<void> {
    if (!this.seal) {
      const seal = await import('node-seal');
      this.seal = await seal.default();
    }
    this.params = params;

    const schemeType = params.scheme === 'BFV'
      ? this.seal.SchemeType.bfv
      : this.seal.SchemeType.ckks;

    const ep = this.seal.EncryptionParameters(schemeType);
    ep.setPolyModulusDegree(params.polyModulusDegree);
    ep.setCoeffModulus(this.seal.CoeffModulus.BFVDefault(params.polyModulusDegree));
    if (schemeType === this.seal.SchemeType.bfv) {
      ep.setPlainModulus(this.seal.PlainModulus.Batching(
        params.polyModulusDegree, params.plainModulus ?? 20));
    }
    this.context = this.seal.Context(ep, true, this.seal.SecurityLevel.tc128);
    this.encoder = this.seal.BatchEncoder(this.context);
  }

  async generateKeys(): Promise<HEKeyBundle> {
    const keygen = this.seal.KeyGenerator(this.context);
    this.secretKey = keygen.secretKey();
    this.publicKey = keygen.createPublicKey();
    this.encryptor = this.seal.Encryptor(this.context, this.publicKey);
    this.decryptor = this.seal.Decryptor(this.context, this.secretKey);
    return {
      publicKey: this.publicKey.save(),
      secretKey: this.secretKey.save(),
    };
  }

  async encryptTokens(tokens: string[]): Promise<HESearchIndex> {
    if (!this.encryptor) throw new Error('keys not generated');
    // 각 토큰을 코드포인트 벡터로 변환 → 슬롯에 배치 → 암호화
    // BFV slots = polyModulusDegree (보통 4096)
    const slotCount = this.encoder.slotCount;
    const vec = new BigInt64Array(slotCount);
    let off = 0;
    for (const t of tokens) {
      for (let i = 0; i < t.length && off < slotCount; i++, off++) {
        vec[off] = BigInt(t.charCodeAt(i));
      }
      if (off < slotCount) { vec[off] = 0n; off++; }   // separator
    }
    const plain = this.encoder.encode(vec);
    const ct = this.encryptor.encrypt(plain);
    return {
      tokenCount: tokens.length,
      ciphertext: ct.save(),
      params: this.params,
      publicKey: this.publicKey.save(),
      engine: this.kind,
    };
  }

  async search(_index: HESearchIndex, _query: string): Promise<boolean> {
    // 실제 검색은 동형연산 (ct - target)² 후 슬롯 합 = 0 검사.
    // PoC 단계에선 단순 placeholder — 실제 검색 로직은 Phase 1.5.
    return false;
  }

  dispose(): void {
    try { this.encryptor?.delete?.(); } catch { /* ignore */ }
    try { this.decryptor?.delete?.(); } catch { /* ignore */ }
    try { this.encoder?.delete?.(); } catch { /* ignore */ }
    try { this.publicKey?.delete?.(); } catch { /* ignore */ }
    try { this.secretKey?.delete?.(); } catch { /* ignore */ }
    try { this.context?.delete?.(); } catch { /* ignore */ }
    this.seal = null;
  }
}

// ─────────────────────────────────────────────
// openFHE 자리 표시 (차후 마이그레이션)
// ─────────────────────────────────────────────

class OpenFHEEngine implements HEEngine {
  readonly kind: HEEngineKind = 'openfhe@1';
  async init(_params: HEContextParams): Promise<void> {
    throw new Error('openFHE 엔진은 아직 통합되지 않았습니다 (Phase: future).');
  }
  async generateKeys(): Promise<HEKeyBundle> { throw new Error('not yet'); }
  async encryptTokens(_t: string[]): Promise<HESearchIndex> { throw new Error('not yet'); }
  async search(): Promise<boolean> { throw new Error('not yet'); }
  dispose(): void {}
}

// ─────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────

export function createHEEngine(kind: HEEngineKind = 'node-seal@5'): HEEngine {
  if (kind === 'node-seal@5') return new NodeSealEngine();
  if (kind === 'openfhe@1') return new OpenFHEEngine();
  throw new Error(`unknown HE engine: ${kind}`);
}

/** 기본 권장 파라미터 — 검색용으로 균형 잡힌 값 */
export const DEFAULT_SEARCH_PARAMS: HEContextParams = {
  scheme: 'BFV',
  polyModulusDegree: 4096,
  plainModulus: 20,
};

/**
 * 텍스트 → 검색 인덱스 (한 번에 처리하는 헬퍼).
 * 토큰화는 단순 공백 + 한글/영문 분리.
 */
export async function buildSearchIndex(
  text: string,
  opts: { engine?: HEEngineKind; params?: HEContextParams } = {},
): Promise<{ index: HESearchIndex; keys: HEKeyBundle }> {
  const engine = createHEEngine(opts.engine ?? 'node-seal@5');
  await engine.init(opts.params ?? DEFAULT_SEARCH_PARAMS);
  const keys = await engine.generateKeys();

  const tokens = text.toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'`~@#$%^&*+=|\\/<>]+/)
    .filter(t => t.length >= 2 && t.length <= 32);
  // 중복 제거 + 빈도 상위 N
  const uniq = Array.from(new Set(tokens)).slice(0, 200);

  const index = await engine.encryptTokens(uniq);
  engine.dispose();
  return { index, keys };
}

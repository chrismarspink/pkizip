# pkizip — RFC 3161 타임스탬프(TST) 구현 명세

## 개요

서명 생성 시 RFC 3161 TSA(Time Stamp Authority)에서 타임스탬프 토큰(TST)을 받아
CMS SignedData의 `unsignedAttrs`에 삽입한다.
TSA 연결 실패 시 `signingTime`으로 자동 폴백한다.
문서 검증 시 TST 전체 검증 체인을 수행한다.

---

## 구현 범위

- 신규: `src/lib/tsa-client.ts` — TSA 요청/응답 처리
- 신규: `src/lib/tsa-health.ts` — TSA 서버 상태 캐시 및 선택
- 신규: `src/lib/tsa-verify.ts` — TST 검증 로직 ★
- 신규: `src/lib/tsa-certs.ts` — TSA 인증서 체인 관리 ★
- 신규: `src/lib/tsa-root-certs.ts` — 루트 CA 번들 ★
- 수정: 기존 서명 로직 — TST 삽입 단계 추가
- 수정: 기존 검증 로직 — TST 검증 단계 추가 ★
- 수정: `src/pages/SettingsPage.tsx` — TSA 설정 UI 추가
- 수정: 서명/검증 결과 화면 — TSA 결과 피드백 표시

**기존 서명 알고리즘, 키 관리, IndexedDB 스키마 변경 없음.**
**오류 수정 없이 이 기능만 추가.**

---

## TSA 서버 목록 (기본값, 우선순위 순)

```typescript
const DEFAULT_TSA_LIST: TsaServer[] = [
  {
    id: 'digicert',
    name: 'DigiCert',
    url: 'https://timestamp.digicert.com',
    priority: 1,
    enabled: true,
  },
  {
    id: 'sectigo',
    name: 'Sectigo',
    url: 'https://timestamp.sectigo.com',
    priority: 2,
    enabled: true,
  },
  {
    id: 'globalsign',
    name: 'GlobalSign',
    url: 'http://timestamp.globalsign.com/tsa/r6advanced1',
    priority: 3,
    enabled: true,
  },
  {
    id: 'freetsa',
    name: 'FreeTSA',
    url: 'https://freetsa.org/tsr',
    priority: 4,
    enabled: true,
  },
];
```

---

## 타입 정의

```typescript
interface TsaServer {
  id: string;
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
  customUrl?: string;
}

interface TsaHealthCache {
  serverId: string;
  responseMs: number;
  lastChecked: number;
  blacklistedUntil?: number;
}

interface TimestampResult {
  success: boolean;
  tsaId?: string;
  tsaName?: string;
  timestampToken?: Uint8Array; // DER 인코딩된 TST
  signingTime?: Date;
  method: 'tst' | 'signingTime' | 'none';
  error?: string;
}

// ── 신규 ──
interface TstVerifyResult {
  valid: boolean;
  genTime?: Date;           // TST에 기록된 타임스탬프 시각
  tsaName?: string;         // TSA 인증서 Subject CN
  method: 'tst' | 'signingTime' | 'none';
  errors: TstVerifyError[];
  warnings: string[];
}

interface TstVerifyError {
  step: TstVerifyStep;
  message: string;
  fatal: boolean;
}

type TstVerifyStep =
  | 'tst_parse'
  | 'eku_check'
  | 'cert_validity'
  | 'chain_build'
  | 'chain_verify'
  | 'revocation'
  | 'tst_signature'
  | 'message_imprint'
  | 'nonce';

// TSA 인증서 캐시
interface TsaCertCache {
  tsaId: string;
  savedAt: number;
  leafCert: string;            // DER base64
  intermediateCerts: string[]; // DER base64 배열
  ocspResponse?: string;       // DER base64 (OCSP Stapling)
  ocspFetchedAt?: number;
}
```

---

## tsa-health.ts — 서버 상태 관리

### 백그라운드 헬스체크 (앱 시작 시 1회)

```typescript
async function checkAllTsaHealth(): Promise<void>
```

- 4개 TSA에 최소 TimeStampReq 전송
- 응답시간 측정 → IndexedDB `tsa_health` 키에 캐시
- 캐시 유효시간: 1시간
- 블랙리스트 확인: `blacklistedUntil > Date.now()` 이면 제외

### 최적 TSA 선택

```typescript
function selectBestTsa(healthCache: TsaHealthCache[]): TsaServer | null
```

선택 알고리즘:
1. `blacklistedUntil` 만료된 서버 제외
2. `enabled: true` 서버만 대상
3. 응답시간 + 신뢰도 가중치 점수 계산
   - DigiCert: 응답시간 × 0.8 (신뢰도 보너스 20%)
   - 나머지: 응답시간 × 1.0
4. 점수 가장 낮은(빠른) 서버 반환

### 블랙리스트 등록

```typescript
function blacklistTsa(serverId: string, durationMs = 30 * 60 * 1000): void
```

---

## tsa-client.ts — TSA 요청/응답

### 메인 함수

```typescript
async function getTimestampToken(
  signatureBytes: Uint8Array,
  options?: { timeoutMs?: number }
): Promise<TimestampResult>
```

**동작 흐름:**

```
1. tsa-health에서 최적 TSA 선택
2. SHA-256(signatureBytes) → messageImprint 생성
3. TimeStampReq 구성 (ASN.1 DER)
4. HTTP POST → TSA URL (Content-Type: application/timestamp-query)
5. 3000ms 내 응답 없으면 timeout
6. 성공: TST(DER) 반환
7. 실패: 해당 TSA 블랙리스트 → 다음 TSA로 폴백
8. 전체 실패: signingTime 폴백
```

### TimeStampReq 필드

- `version`: 1
- `messageImprint`: { hashAlgorithm: SHA-256, hashedMessage }
- `nonce`: `crypto.getRandomValues(new Uint8Array(8))`
- `certReq`: **true** (TSA 인증서 체인 포함 요청 — 오프라인 검증 필수)

### 폴백 체인

```
DigiCert → Sectigo → GlobalSign → FreeTSA → signingTime
(각 3s timeout)
```

---

## ★ tsa-root-certs.ts — 루트 CA 번들 (신규)

```typescript
// 아래 루트 CA DER를 Base64로 하드코딩
// 공식 사이트에서 직접 다운로드하여 포함
// 총 크기 약 10KB, 수십 년간 변경 없음

const BUNDLED_ROOT_CERTS: Record<string, string> = {
  'DigiCert_Global_Root_CA':   '<DER base64>',
  'DigiCert_Global_Root_G2':   '<DER base64>',
  'Sectigo_Public_Root_R46':   '<DER base64>',
  'GlobalSign_Root_CA_R6':     '<DER base64>',
};
```

---

## ★ tsa-certs.ts — TSA 인증서 체인 관리 (신규)

### TSA 인증서 저장 (TST 수신 시 자동 호출)

```typescript
async function saveTsaCertChain(tst: Uint8Array): Promise<void>
```

1. TST.certificates 배열에서 리프 + 중간 CA 추출
2. 리프 인증서 AIA.ocsp URL에서 OCSP 응답 조회 (Stapling)
3. IndexedDB `tsa_cert_cache`에 저장

### 인증서 조회 우선순위

```typescript
async function resolveCertChain(tst: Uint8Array): Promise<CertChain>
```

1. TST.certificates 내부 추출 (최우선)
2. IndexedDB 캐시 조회
3. AIA URL 온라인 다운로드
4. 루트 CA → BUNDLED_ROOT_CERTS에서 조회

---

## ★ tsa-verify.ts — TST 검증 (신규)

### 메인 함수

```typescript
async function verifyTimestampToken(
  tst: Uint8Array,
  originalSignatureBytes: Uint8Array,
  options?: {
    requireOcsp?: boolean; // 기본 false
    nonce?: Uint8Array;
  }
): Promise<TstVerifyResult>
```

### 검증 8단계

#### Step 1. TST 파싱
```
TST DER → ASN.1 파싱
TSTInfo 추출: genTime, messageImprint, serialNumber, nonce
실패 시: fatal — 이후 단계 중단
```

#### Step 2. ExtendedKeyUsage 확인
```
TSA 리프 인증서 EKU:
  id-kp-timeStamping (OID: 1.3.6.1.5.5.7.3.8) 존재 + Critical=true
실패 시: fatal (RFC 3161 필수)
```

#### Step 3. 인증서 유효기간 확인
```
리프 인증서 notBefore ≤ TSTInfo.genTime ≤ notAfter
주의: 현재 시각 기준 아님 — genTime 기준
      TSA 인증서가 현재 만료되어도 발급 당시 유효하면 OK
실패 시: fatal
```

#### Step 4. 인증서 체인 구성 및 서명 검증
```
1. resolveCertChain() 호출
2. 리프 → 중간 CA → 루트 CA 체인 구성
3. 각 단계 서명 검증 (상위 CA 공개키로 하위 인증서 서명 검증)
4. 루트 CA가 BUNDLED_ROOT_CERTS에 포함 확인
5. Subject/Issuer DN 연속성 확인
실패 시: fatal
```

#### Step 5. 폐기 상태 확인 (OCSP/CRL)
```
우선순위:
  1. IndexedDB OCSP Stapling 응답 사용
     - ocspFetchedAt 기준 7일 이내만 유효
     - OCSP thisUpdate ≤ genTime 확인
  2. 없거나 만료 → 온라인 OCSP 조회 (AIA.ocsp)
  3. OCSP 실패 → CRL 조회 (AIA.crlDistributionPoints)
  4. 모두 실패 → warning (requireOcsp=true이면 fatal)

판정:
  OCSP good                          → 통과
  OCSP revoked + revocationTime ≤ genTime → fatal (발급 당시 폐기)
  OCSP revoked + revocationTime > genTime → warning (발급 후 폐기 — TST는 유효)
  OCSP unknown / 조회 불가           → warning
```

#### Step 6. TST 서명값 검증
```
TSA 리프 인증서 공개키로 SignerInfo.signature 검증
서명 대상: SignerInfo.signedAttrs (DER)
알고리즘: SignerInfo.signatureAlgorithm (보통 RSA-SHA256 또는 ECDSA-SHA256)
실패 시: fatal
```

#### Step 7. messageImprint 검증 (핵심)
```
SHA-256(originalSignatureBytes) == TSTInfo.messageImprint.hashedMessage
해시 알고리즘: TSTInfo.messageImprint.hashAlgorithm 에 명시된 알고리즘 사용
실패 시: fatal
의미: "이 TST가 이 서명과 연결됨" 암호학적 증명
```

#### Step 8. nonce 확인
```
options.nonce 제공 시: TSTInfo.nonce == options.nonce 확인
불일치 시: warning (저장된 TST 재검증 시 nonce 없음 — fatal 아님)
```

### valid 판정 기준

```typescript
const valid = result.errors.filter(e => e.fatal).length === 0;
// Step 1~4, 6, 7은 반드시 통과해야 valid
// Step 5는 requireOcsp 옵션에 따라
// Step 8은 항상 warning
```

---

## 기존 서명 로직 수정

```typescript
// 기존 서명 생성 (변경 없음)
const signature = await signData(data, privateKey);

// ── 추가 ──
const tsaEnabled = await getSettings('tsa_enabled') ?? true;

if (tsaEnabled && navigator.onLine) {
  const tsResult = await getTimestampToken(signature);

  if (tsResult.method === 'tst') {
    await insertTimestampToken(cmsSignedData, tsResult.timestampToken!);
    // TSA 인증서 + OCSP 저장 (장기 검증용)
    await saveTsaCertChain(tsResult.timestampToken!);
  } else {
    await insertSigningTime(cmsSignedData, tsResult.signingTime ?? new Date());
  }
}

return { signature: cmsSignedData, timestampResult: tsResult };
```

---

## ★ 기존 문서 검증 로직 수정 (신규)

```typescript
// 기존 서명 검증 (변경 없음)
const sigValid = await verifySignature(cmsSignedData, signerCert);

// ── 추가: TST 검증 ──
let tstResult: TstVerifyResult;

const tst = extractTimestampToken(cmsSignedData);
// unsignedAttrs OID 1.2.840.113549.1.9.16.2.14 에서 추출

if (tst) {
  const originalSig = extractSignatureBytes(cmsSignedData);
  tstResult = await verifyTimestampToken(tst, originalSig, {
    requireOcsp: await getSettings('tsa_require_ocsp') ?? false,
  });
} else {
  const signingTime = extractSigningTime(cmsSignedData);
  tstResult = {
    valid: true,
    genTime: signingTime ?? undefined,
    method: signingTime ? 'signingTime' : 'none',
    errors: [],
    warnings: signingTime
      ? ['TST 없음. signingTime은 서명자 주장 시각으로 신뢰도가 낮습니다.']
      : ['타임스탬프 없음.'],
  };
}

return { signatureValid: sigValid, timestamp: tstResult };
```

---

## 검증 결과 UI

| 상황 | 표시 | 아이콘 |
|------|------|--------|
| TST 유효 | "DigiCert TSA 인증 · 2026.04.21 14:23:01" | ✅ |
| TST 유효 + OCSP 미확인 | "TSA 인증 (폐기 확인 불가)" | ⚠️ |
| signingTime만 있음 | "서명자 주장 시각 · 신뢰도 낮음" | ⚠️ |
| TST 서명 검증 실패 | "타임스탬프 위변조 감지" | ❌ |
| messageImprint 불일치 | "타임스탬프-서명 불일치" | ❌ |
| 타임스탬프 없음 | "타임스탬프 없음" | — |

검증 결과 상세 보기 (펼치기):
```
TSA 서버:       DigiCert Timestamp Responder
타임스탬프 시각: 2026-04-21 14:23:01 UTC
TSA 인증서:     유효 (2024.01.01 ~ 2027.01.01)
인증서 체인:    DigiCert Root CA → 중간 CA → TSA 리프
폐기 확인:      OCSP 정상 (Stapling, 2026.04.20 조회)
서명 검증:      RSA-SHA256 일치
문서 연결:      SHA-256 해시 일치
```

---

## 설정 UI (SettingsPage.tsx)

### 기본

```
[ 타임스탬프 ]
타임스탬프 추가  ●────  ON
TSA 서버         자동 선택
```

### 고급 (펼치기)

```
▼ 고급 TSA 설정

TSA 우선순위 (드래그):
  1. ● DigiCert    [비활성화]
  2. ● Sectigo     [비활성화]
  3. ● GlobalSign  [비활성화]
  4. ● FreeTSA     [비활성화]

커스텀 TSA URL: [________________] [추가]
타임아웃: [3] 초
폐기 확인 (OCSP) 필수: ○ ON  ●── OFF
```

### IndexedDB 저장 키

```typescript
'tsa_enabled'      : boolean          // 기본 true
'tsa_server_list'  : TsaServer[]      // 기본 DEFAULT_TSA_LIST
'tsa_timeout_ms'   : number           // 기본 3000
'tsa_health_cache' : TsaHealthCache[] // 헬스체크 캐시
'tsa_cert_cache'   : TsaCertCache[]   // TSA 인증서 + OCSP ★
'tsa_require_ocsp' : boolean          // 기본 false ★
```

---

## 지연 타임스탬프 (Delayed Timestamping)

```typescript
window.addEventListener('online', async () => {
  const pendingFiles = await getPendingTstFiles();
  for (const file of pendingFiles) {
    await addDelayedTimestamp(file);
  }
});
```

---

## 보안 주의사항

- TSA에 전송: **서명값 SHA-256 해시만** (원본 문서 미전송)
- `certReq: true` 필수 — 없으면 TST 내 인증서 누락으로 오프라인 검증 불가
- 루트 CA 번들: 배포 전 공식 사이트에서 직접 다운로드
- OCSP Stapling 유효기간: 7일 초과 시 재조회
- HTTPS TSA만 허용 (freetsa 예외: 경고 표시)
- nonce로 replay attack 방지

---

## 라이브러리

```bash
npm install @peculiar/asn1-rfc3161 @peculiar/asn1-cms @peculiar/x509
```

- `@peculiar/asn1-rfc3161`: TimeStampReq/Resp 파싱
- `@peculiar/asn1-cms`: CMS SignedData 조작
- `@peculiar/x509`: 인증서 체인 검증, OCSP 요청

---

## 구현 순서

1. `tsa-root-certs.ts` — 루트 CA DER 번들
2. `tsa-certs.ts` — 인증서 체인 추출/저장/OCSP Stapling
3. `tsa-client.ts` — TimeStampReq 빌드 + HTTP 요청
4. `tsa-health.ts` — 헬스체크 + 서버 선택 + 블랙리스트
5. `tsa-verify.ts` — TST 검증 8단계
6. 기존 서명 로직 — TST 삽입 + 인증서 저장
7. 기존 검증 로직 — TST 검증 단계 추가
8. `SettingsPage.tsx` — 설정 UI
9. 서명/검증 결과 화면 — 피드백
10. 지연 타임스탬프 — online 이벤트 핸들러
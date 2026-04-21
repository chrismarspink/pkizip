# pkizip — RFC 3161 타임스탬프(TST) 구현 명세

## 개요

서명 생성 시 RFC 3161 TSA(Time Stamp Authority)에서 타임스탬프 토큰(TST)을 받아
CMS SignedData의 `unsignedAttrs`에 삽입한다.
TSA 연결 실패 시 `signingTime`으로 자동 폴백한다.

---

## 구현 범위

- 신규: `src/lib/tsa-client.ts` — TSA 요청/응답 처리
- 신규: `src/lib/tsa-health.ts` — TSA 서버 상태 캐시 및 선택
- 수정: 기존 서명 로직 — TST 삽입 단계 추가
- 수정: `src/pages/SettingsPage.tsx` — TSA 설정 UI 추가
- 수정: 서명 결과 화면 — TSA 결과 피드백 표시

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
  customUrl?: string; // 사용자 커스텀 URL
}

interface TsaHealthCache {
  serverId: string;
  responseMs: number;       // 응답시간 (ms)
  lastChecked: number;      // timestamp
  blacklistedUntil?: number; // 블랙리스트 만료 timestamp
}

interface TimestampResult {
  success: boolean;
  tsaId?: string;
  tsaName?: string;
  timestampToken?: Uint8Array; // DER 인코딩된 TST
  signingTime?: Date;          // 폴백 시 사용
  method: 'tst' | 'signingTime' | 'none';
  error?: string;
}
```

---

## tsa-health.ts — 서버 상태 관리

### 백그라운드 헬스체크 (앱 시작 시 1회)

```typescript
// 앱 초기화 시 호출
async function checkAllTsaHealth(): Promise<void>
```

- 4개 TSA에 최소 TimeStampReq 전송 (또는 HEAD 요청)
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
3. 응답시간 + 신뢰도 가중치로 점수 계산
   - DigiCert: 응답시간 × 0.8 (신뢰도 보너스 20%)
   - 나머지: 응답시간 × 1.0
4. 점수 가장 낮은(빠른) 서버 반환

### 블랙리스트 등록

```typescript
function blacklistTsa(serverId: string, durationMs = 30 * 60 * 1000): void
```

- 연속 실패 시 30분 블랙리스트
- IndexedDB 캐시 업데이트

---

## tsa-client.ts — TSA 요청/응답

### 메인 함수: TST 획득

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

### TimeStampReq 구성

```typescript
function buildTimestampRequest(
  messageImprint: Uint8Array,  // SHA-256 해시
  nonce: Uint8Array            // crypto.getRandomValues(new Uint8Array(8))
): Uint8Array                  // DER 인코딩
```

RFC 3161 TimeStampReq 필드:
- `version`: 1
- `messageImprint`: { hashAlgorithm: SHA-256, hashedMessage }
- `nonce`: 8바이트 랜덤
- `certReq`: true (TSA 인증서 포함 요청)

### 폴백 체인

```
DigiCert (3s timeout)
  └─ 실패 → Sectigo (3s timeout)
       └─ 실패 → GlobalSign (3s timeout)
            └─ 실패 → FreeTSA (3s timeout)
                 └─ 실패 → signingTime (로컬 시각)
```

---

## 기존 서명 로직 수정

서명 생성 완료 후 아래 단계 추가:

```typescript
// 기존 서명 생성 (변경 없음)
const signature = await signData(data, privateKey);

// ── 추가 단계 ──
// 1. TSA 설정 확인
const tsaEnabled = await getSettings('tsa_enabled') ?? true;

if (tsaEnabled && navigator.onLine) {
  // 2. TST 요청
  const tsResult = await getTimestampToken(signature);

  if (tsResult.method === 'tst') {
    // 3. CMS unsignedAttrs에 TST 삽입
    //    OID: 1.2.840.113549.1.9.16.2.14 (id-aa-signatureTimeStampToken)
    await insertTimestampToken(cmsSignedData, tsResult.timestampToken!);
  } else {
    // 4. 폴백: signedAttrs에 signingTime 삽입
    await insertSigningTime(cmsSignedData, tsResult.signingTime ?? new Date());
  }
}

// 5. 결과 반환 시 tsResult 포함
return { signature: cmsSignedData, timestampResult: tsResult };
```

### insertTimestampToken

```typescript
async function insertTimestampToken(
  cmsSignedData: CmsSignedData,
  tst: Uint8Array
): Promise<void>
```

- `SignerInfo.unsignedAttrs` 배열에 추가
- OID: `1.2.840.113549.1.9.16.2.14`
- 기존 서명값 불변 (unsignedAttrs는 서명 범위 밖)

---

## 설정 UI (SettingsPage.tsx)

### 기본 설정 섹션 (항상 표시)

```
[ 타임스탬프 ]
타임스탬프 추가  ●────  ON
TSA 서버         자동 선택
```

### 고급 설정 (펼치기 토글)

```
▼ 고급 TSA 설정

TSA 서버 우선순위 (드래그로 변경):
  1. ● DigiCert          [비활성화]
  2. ● Sectigo           [비활성화]
  3. ● GlobalSign        [비활성화]
  4. ● FreeTSA           [비활성화]

커스텀 TSA URL:  [________________] [추가]

타임아웃: [3] 초
```

### IndexedDB 저장 키

```typescript
// settings store
'tsa_enabled'        : boolean        // 기본 true
'tsa_server_list'    : TsaServer[]    // 기본 DEFAULT_TSA_LIST
'tsa_timeout_ms'     : number         // 기본 3000
'tsa_health_cache'   : TsaHealthCache[] // 헬스체크 캐시
```

---

## 서명 결과 화면 피드백

서명 완료 후 타임스탬프 결과 표시:

| 상황 | 표시 |
|------|------|
| TST 성공 | "DigiCert TSA 타임스탬프 완료 · 2026.04.21 14:23:01" |
| signingTime 폴백 | "타임스탬프 없음 (오프라인) · 로컬 시각 기록됨" |
| TSA 비활성 | 표시 없음 |
| 네트워크 복구 후 추가 가능 | "나중에 타임스탬프 추가" 버튼 표시 |

### 지연 타임스탬프 추가 (Delayed Timestamping)

서명 후 오프라인이었다가 온라인 복구 시:

```typescript
// 파일 메타데이터에 'tst_pending: true' 플래그
// 온라인 감지 시 자동 처리
window.addEventListener('online', async () => {
  const pendingFiles = await getPendingTstFiles();
  for (const file of pendingFiles) {
    await addDelayedTimestamp(file);
  }
});
```

---

## 보안 주의사항

- TSA에 전송하는 것: **서명값의 SHA-256 해시만** (원본 문서 내용 미전송)
- nonce 사용으로 replay attack 방지
- TSA 응답의 서명 검증 (TSA 인증서로 TST 서명 검증)
- HTTPS TSA URL만 허용 (freetsa 예외: HTTP도 허용하되 경고 표시)

---

## 라이브러리

기존 ASN.1/CMS 라이브러리 있으면 재사용.
없으면 `@peculiar/asn1-rfc3161` 사용:

```bash
npm install @peculiar/asn1-rfc3161 @peculiar/asn1-cms
```

---

## 구현 순서

1. `tsa-client.ts` — TimeStampReq 빌드 + HTTP 요청
2. `tsa-health.ts` — 헬스체크 + 서버 선택 + 블랙리스트
3. 기존 서명 로직 — TST 삽입 단계 추가
4. `SettingsPage.tsx` — 설정 UI
5. 서명 결과 화면 — 피드백 표시
6. 지연 타임스탬프 — online 이벤트 핸들러

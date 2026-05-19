# PKIZIP — PDF 변환 한국어 폰트

`#8-A. 봉투 → PDF 변환` 시 한국어 본문/워터마크가 □ 로 깨지지 않도록 이 디렉토리에 한국어 폰트 (TTF) 파일을 1개 이상 배치한다.

## 우선순위 (자동 fetch 순서)

1. `Pretendard-Regular.ttf` (권장 — 한·영·숫자 균형, OFL 라이센스)
2. `NanumGothic-Regular.ttf` (대안 — OFL 라이센스, 네이버)

`src/lib/analysis/text-to-pdf.ts` 의 `loadKoreanFont()` 가 위 순서로 fetch 시도. 1번 발견 시 2번 안 받음. 둘 다 없으면 helvetica fallback (한글 □).

## 다운로드 방법

### Pretendard (권장)

```bash
cd public/fonts
curl -L -o Pretendard-Regular.ttf \
  https://github.com/orioncactus/pretendard/raw/main/packages/pretendard/dist/public/static/Pretendard-Regular.ttf
```

라이센스: SIL Open Font License 1.1 — 상업/비상업 자유 사용 OK.

### NanumGothic (대안)

```bash
cd public/fonts
curl -L -o NanumGothic-Regular.ttf \
  https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf
```

라이센스: SIL Open Font License 1.1.

## 빌드 영향

- 메인 번들에 포함되지 X — `public/fonts/` 는 정적 자원
- 사용자가 PDF 변환 옵션 ON 했을 때만 `fetch('/fonts/...')` 로 lazy load
- 처음 1회 로드 후 `cachedFontBase64` 변수에 캐시

## 라이센스 표기

배포 시 `LICENSE` 또는 `NOTICE` 에 폰트 라이센스 명시 권장:

```
이 제품은 SIL Open Font License 1.1 하의 Pretendard / NanumGothic 폰트를 사용합니다.
```

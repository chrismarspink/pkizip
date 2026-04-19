# PKIZIP 컬러 시스템

> Bitwarden 스타일 네이비/블루 계열. 2026-04-19 적용.

## 핵심 팔레트

| 이름 | HEX | CSS 변수 | 용도 |
|------|-----|----------|------|
| Bitwarden Blue | `#175DDC` | `--brand-primary` | 주요 버튼, 링크, 활성 탭, 포커스 링 |
| Deep Blue | `#0C3276` | `--brand-primary-dark` | 헤더, PWA 타이틀바, 카드 그라디언트 끝, hover |
| Primary Light | `#EEF3FC` | `--brand-primary-light` | 사이드바 활성 배경, 선택 카드 연한 배경 |
| Teal Highlight | `#2CDDE9` | `--brand-accent` | 보조 강조 (향후 사용) |
| Light Teal | `#A2F4FD` | `--brand-accent-light` | 아이콘 배경 (향후 사용) |

## 표면/배경

| 이름 | HEX | CSS 변수 | 용도 |
|------|-----|----------|------|
| Off White | `#F3F6F9` | `--color-bg` | 페이지 배경, PWA background_color |
| True White | `#FFFFFF` | — | 카드 배경 |
| Light Grey | `#D8E2EB` | `--color-border` | 테두리, 구분선 |
| Medium Grey | `#99A7B5` | `--color-muted` | 보조 텍스트, 비활성 |

## 시맨틱 (성공/오류/경고)

| 이름 | HEX | CSS 변수 | 용도 |
|------|-----|----------|------|
| Success Green | `#16a34a` | `--color-success` | 성공 체크, TaskStream 완료 도트, "✓" 텍스트 |
| Success Light | `bg-green-100` | — | 성공 아이콘 배경 (Tailwind) |
| Danger Red | `#FF6550` | `--color-danger` | 오류, 삭제 확인 |
| Warning Yellow | `#FDC700` | — | 경고 |

## PQC 전용 (변경 없음)

| 이름 | HEX | 용도 |
|------|-----|------|
| PQC Violet | `bg-violet-600` / `bg-violet-100` | ML-KEM / ML-DSA 배지 |
| Q Badge | `bg-violet-600 text-white` | Quantum Protected 배지 |
| C Badge | `bg-zinc-400 text-white` | Classical 배지 |

> 보라 = 양자: IBM Quantum·Quantinuum 등이 확립한 업계 시각 언어.
> PQC 배지만 보라로 남겨 "일반 암호화와 다르다"는 시각 신호 유지.

## PWA 설정

```
index.html  meta theme-color: #0C3276 (Deep Blue — 브라우저 주소창)
vite.config manifest.theme_color: #175DDC (Bitwarden Blue — PWA 타이틀바)
vite.config manifest.background_color: #F3F6F9 (Off White — 스플래시)
```

## 적용 규칙

| 요소 | 컬러 |
|------|------|
| 주요 CTA 버튼 | `bg-[#175DDC] text-white` |
| 포커스 링 | `focus:ring-[#175DDC]` |
| hover (dashed 버튼) | `hover:border-[#175DDC] hover:text-[#175DDC]` |
| 활성 사이드바 항목 | `bg-[#175DDC]/10 text-[#175DDC]` |
| 활성 하단 탭 | `text-[#175DDC]` |
| 인증서 카드 활성 배경 | `from-[#175DDC] to-[#0C3276]` 그라디언트 |
| 인증서 카드 잠김 배경 | `from-zinc-600 to-zinc-700` 그라디언트 |
| 토글 스위치 ON | `bg-[#175DDC]` |
| 선택된 옵션 카드 | `border-[#175DDC] bg-[#175DDC]/5` |
| 성공 체크 아이콘 | `bg-green-100 text-green-600` (초록 유지) |
| 에러 텍스트 | `text-red-500` |
| ML-KEM/DSA 배지 | `bg-violet-100 text-violet-600` (보라 유지) |

## 변경 이력

- 2026-04-19: `#1DC078` (초록) → `#175DDC` (블루) 전면 교체
  - 14개 소스 파일 + index.html + vite.config.ts
  - 성공 상태(체크마크, 완료 텍스트)는 초록 유지
  - PQC 배지 보라 유지

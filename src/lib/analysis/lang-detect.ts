/**
 * 문서 언어 감지 — franc-min 래퍼.
 *
 * 비한국어 문서는 PII 탐지 정확도가 떨어지므로 등급 하한 적용 (S 이상).
 * Step 4 의 "언어우회 방지" 핵심.
 *
 * franc 는 ISO 639-3 코드 반환 → ISO 639-1 로 매핑.
 */
import { franc } from 'franc-min';
import type { LanguageDetection } from './types';

// franc 가 반환하는 ISO 639-3 → 우리가 쓰는 ISO 639-1
const ISO_3_TO_1: Record<string, string> = {
  kor: 'ko', eng: 'en', jpn: 'ja', cmn: 'zh', spa: 'es',
  fra: 'fr', deu: 'de', rus: 'ru', vie: 'vi', tha: 'th',
  ind: 'id', por: 'pt', ara: 'ar', tur: 'tr', ita: 'it',
  pol: 'pl', nld: 'nl', swe: 'sv', dan: 'da', nor: 'no',
};

const DETECTOR_VERSION = 'franc-min@6';

/**
 * 텍스트 언어 감지. 짧거나 깨진 텍스트는 'und' (undetermined) 반환.
 *
 * franc-min 은 trigram 기반이라 깨진 PDF (Korean 폰트 손실 → Latin 조각만
 * 남음) 를 보면 프랑스어 / 라틴어 등으로 마구 오탐. 다음 가드들로 보강:
 *   1) 한글 한 글자라도 있으면 (>= 2%) 한국어로 강제 (ko 가 mixed 의 base)
 *   2) "깨짐" 휴리스틱 — 특수문자 비율 매우 높거나 단어 평균 길이 매우 짧거나
 *      → confidence 강제 하향, 또는 'und'
 *   3) franc 가 ko/en 외 언어를 골라도 한글 비율 + 영문 비율로 검증
 *      예: 한글 2% + 영문 30% + 깨진문자 60% → 'und' / 매우 낮은 confidence
 */
export function detectLanguage(text: string, opts: { onlyKorean?: boolean } = {}): LanguageDetection {
  const sample = text.length > 4000 ? text.substring(0, 4000) : text;
  if (!sample || sample.trim().length < 10) {
    return { detected: 'und', confidence: 0, multilingual: false, detectorVersion: DETECTOR_VERSION };
  }

  // 문자 통계
  const han = (sample.match(/[가-힯]/g) || []).length;
  const lat = (sample.match(/[A-Za-z]/g) || []).length;
  const cjk = (sample.match(/[一-龥ぁ-んァ-ヶ]/g) || []).length;     // 한자/일본어
  const digits = (sample.match(/\d/g) || []).length;
  const printable = sample.length;
  const linguistic = han + lat + cjk;
  const hanRatio = linguistic > 0 ? han / linguistic : 0;
  const linguisticRatio = printable > 0 ? linguistic / printable : 0;

  // 가드 1) 한글이 일정 비율 이상이면 무조건 ko (mixed 문서의 base 언어)
  // PDF 추출이 깨져도 한글이 조금이라도 남아있으면 한국어 문서로 간주
  if (hanRatio >= 0.02 && han >= 5) {
    const conf = 0.6 + 0.4 * Math.min(1, hanRatio * 2);
    const multilingual = lat > 0 && hanRatio < 0.7;
    return { detected: 'ko', confidence: round3(conf), multilingual, detectorVersion: DETECTOR_VERSION };
  }

  // 가드 2) 언어 문자 비율이 매우 낮으면 (특수문자/숫자 위주) — 깨진 추출
  // linguistic / printable < 0.3 이면 신뢰할 수 없다 → 'und'
  if (linguisticRatio < 0.3) {
    return { detected: 'und', confidence: 0.2, multilingual: false, detectorVersion: DETECTOR_VERSION };
  }

  // franc 호출
  const code3 = franc(sample, opts.onlyKorean ? { only: ['kor', 'eng'] } : undefined);
  const detected = ISO_3_TO_1[code3] || code3 || 'und';

  // 가드 3) franc 가 ko/en 이 아닌 언어를 골랐는데 한자도 0건이면 의심
  // 짧은 Latin 조각으로 fr/es/it 오탐하는 케이스 → confidence 강제 하향
  let confidence = 0.7;
  if (detected === 'ko') {
    confidence = 0.6 + 0.4 * hanRatio;
  } else if (detected === 'en') {
    // 영문은 라틴 비율이 충분히 높을 때만 확신
    confidence = lat > 100 && hanRatio < 0.05 ? 0.85 : 0.6;
  } else if (detected === 'und') {
    confidence = 0.2;
  } else {
    // 기타 언어 (fr/es/de/...) — 깨진 PDF 의 흔한 오탐 영역
    // 단어 평균 길이가 짧거나 (조각만 남은 경우) 텍스트 짧으면 신뢰도 낮춤
    const words = sample.match(/[A-Za-z가-힯]+/g) || [];
    const avgWordLen = words.length > 0
      ? words.reduce((s, w) => s + w.length, 0) / words.length : 0;
    const veryShortWords = avgWordLen < 4;
    confidence = veryShortWords || lat < 200 ? 0.4 : 0.6;
  }
  void digits;

  let multilingual = false;
  if (hanRatio > 0.1 && hanRatio < 0.7) {
    multilingual = true;
    confidence = Math.max(0.6, confidence - 0.1);
  }

  return {
    detected,
    confidence: round3(confidence),
    multilingual,
    detectorVersion: DETECTOR_VERSION,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

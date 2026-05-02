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
 * 텍스트 언어 감지. 짧으면 'und' (undetermined) 반환.
 */
export function detectLanguage(text: string, opts: { onlyKorean?: boolean } = {}): LanguageDetection {
  const sample = text.length > 4000 ? text.substring(0, 4000) : text;
  if (!sample || sample.trim().length < 10) {
    return {
      detected: 'und',
      confidence: 0,
      multilingual: false,
      detectorVersion: DETECTOR_VERSION,
    };
  }

  // franc.all() 으로 후보 점수도 같이
  const code3 = franc(sample, opts.onlyKorean ? { only: ['kor', 'eng'] } : undefined);
  const detected = ISO_3_TO_1[code3] || code3 || 'und';

  // 신뢰도 — franc 자체는 점수 안 줘서 한글 비율로 보강
  const han = (sample.match(/[가-힯]/g) || []).length;
  const lat = (sample.match(/[A-Za-z]/g) || []).length;
  const total = han + lat;
  const hanRatio = total > 0 ? han / total : 0;
  let confidence = 0.7;
  let multilingual = false;
  if (detected === 'ko') {
    confidence = 0.6 + 0.4 * hanRatio;
  } else if (detected === 'en' && hanRatio < 0.05) {
    confidence = 0.85;
  }
  if (hanRatio > 0.1 && hanRatio < 0.7) {
    multilingual = true;
    confidence = Math.max(0.6, confidence - 0.1);
  }

  return {
    detected,
    confidence: Math.round(confidence * 1000) / 1000,
    multilingual,
    detectorVersion: DETECTOR_VERSION,
  };
}

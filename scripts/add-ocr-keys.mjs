#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const VALUES = {
  ko: {
    ocrRunning: 'OCR 처리 중 — {{file}}',
    ocrFirstRunNote: '첫 실행 시 언어 모델(약 10–30MB)을 다운로드합니다. 이후엔 캐시되어 즉시 시작.',
  },
  en: {
    ocrRunning: 'OCR running — {{file}}',
    ocrFirstRunNote: 'On first use the language model (~10–30MB) downloads once. Cached after.',
  },
  ja: {
    ocrRunning: 'OCR 処理中 — {{file}}',
    ocrFirstRunNote: '初回は言語モデル(約 10–30MB)をダウンロードします。以後はキャッシュから即起動。',
  },
  zh: {
    ocrRunning: 'OCR 处理中 — {{file}}',
    ocrFirstRunNote: '首次使用时下载语言模型(约 10–30MB)。之后从缓存即时启动。',
  },
};

for (const [lang, body] of Object.entries(VALUES)) {
  const path = `src/i18n/locales/${lang}.json`;
  const obj = JSON.parse(readFileSync(path, 'utf-8'));
  obj.create = { ...obj.create, ...body };
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
  console.log(`updated ${path}`);
}

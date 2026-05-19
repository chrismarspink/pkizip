#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const VALUES = {
  ko: { noneRegistered: '등록된 인증서가 없습니다', subtitle: '스와이프하여 상세 정보와 설정을 확인하세요.' },
  en: { noneRegistered: 'No certificates registered', subtitle: 'Swipe to view details and settings.' },
  ja: { noneRegistered: '登録された証明書がありません', subtitle: 'スワイプで詳細と設定を確認' },
  zh: { noneRegistered: '未注册任何证书', subtitle: '滑动查看详情与设置。' },
};

for (const [lang, body] of Object.entries(VALUES)) {
  const path = `src/i18n/locales/${lang}.json`;
  const obj = JSON.parse(readFileSync(path, 'utf-8'));
  obj.certificates = { ...obj.certificates, ...body };
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
  console.log(`updated ${path}`);
}

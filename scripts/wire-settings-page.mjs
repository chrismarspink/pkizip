#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/pages/SettingsPage.tsx';
let src = readFileSync(path, 'utf-8');

const R = [
  // JSX text nodes
  ['>양자 암호 보호<',   '>{t(\'settings.pqc\')}<'],
  ['>암호화 (KEM)<',    '>{t(\'settings.pqcKem\')}<'],
  ['>전자서명 (DSA)<',  '>{t(\'settings.pqcDsa\')}<'],
  ['>상세 설정<',       '>{t(\'settings.pqcDetails\')}<'],
  ['>접기<',           '>{t(\'settings.collapse\')}<'],
  ['>인증서 공유<',     '>{t(\'settings.certShare\')}<'],
  ['>공유 중<',         '>{t(\'settings.shared\')}<'],
  ['>미공유<',          '>{t(\'settings.notShared\')}<'],
  ['>공유 삭제<',       '>{t(\'settings.shareDelete\')}<'],
  ['>재업로드<',        '>{t(\'settings.reupload\')}<'],
  ['>공유<',           '>{t(\'settings.share\')}<'],
  ['>활성<',           '>{t(\'settings.active\')}<'],
  ['>비활성<',          '>{t(\'settings.inactive\')}<'],
  ['>미사용<',          '>{t(\'settings.notUsed\')}<'],
  ['>로그인<',          '>{t(\'settings.signin\')}<'],
  ['>삭제<',           '>{t(\'settings.delete\')}<'],
  ['>취소<',           '>{t(\'settings.cancel\')}<'],
  ['>현재 버전<',       '>{t(\'settings.currentVersion\')}<'],
  ['>서명 타임스탬프<',  '>{t(\'settings.tsaSignTime\')}<'],
  ['>우선순위 순 (위에서 아래로 시도, 실패 시 다음)<',
   '>{t(\'settings.tsaPriority\')}<'],
  ['>인증서가 없습니다. 먼저 키를 생성하세요.<',
   '>{t(\'settings.noCerts\')}<'],
  ['>저장된 백업이 없습니다.<',
   '>{t(\'settings.noBackups\')}<'],
  ['>로그인하면 니모닉을 서버에 암호화 백업할 수 있습니다.<',
   '>{t(\'settings.loginToBackup\')}<'],
  ['>로그인하면 인증서를 공유하고 검색할 수 있습니다.<',
   '>{t(\'settings.loginToShare\')}<'],
  // string literals
  ['\"캐시 강제 청소\"', 't(\'settings.forceClearCache\')'],
  ['\'PQC 미적용 (양자 취약)\'', 't(\'settings.pqcOff\')'],
  ['\'기존 암호만\'', 't(\'settings.pqcLegacy\')'],
  ['\'Hybrid (RSA + PQC 병행)\'', 't(\'settings.pqcHybrid\')'],
  ['\'PQC 전용\'', 't(\'settings.pqcOnly\')'],
  ['\'기존 호환성 유지 + 양자 보호\'', 't(\'settings.pqcLegacyDesc\')'],
  ['\'최고 보안, 기존 암호 미사용\'', 't(\'settings.pqcOnlyDesc\')'],
  ['\'PQC 설정 저장됨\'', 't(\'settings.pqcSavedMsg\')'],
  ['\'인증서 공유 완료\'', 't(\'settings.shareDoneMsg\')'],
  ['\'공유 삭제 완료\'', 't(\'settings.shareDeletedMsg\')'],
  ['\'업로드 실패\'', 't(\'settings.uploadFail\')'],
  ['\'업로드 중...\'', 't(\'settings.uploading\')'],
  ['\'삭제 실패\'', 't(\'settings.deleteFail\')'],
  ['\'백업 삭제 완료\'', 't(\'settings.backupDeleted\')'],
  ['\'TSA 서버 설정\'', 't(\'settings.tsaServer\')'],
  ['\'서명 시 RFC 3161 TSA에서 타임스탬프를 발급받습니다. 실패 시 로컬 시각으로 폴백합니다.\'',
   't(\'settings.tsaSignDesc\')'],
  ['\'타임스탬프 비활성 — 서명에 시각 정보가 포함되지 않습니다.\'',
   't(\'settings.tsaInactive\')'],
];

let applied = 0;
for (const [from, to] of R) {
  const before = src;
  src = src.split(from).join(to);
  if (before !== src) applied++;
}
writeFileSync(path, src);
console.log('applied:', applied, '/', R.length);

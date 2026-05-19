#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/pages/FilesTempPage.tsx';
let src = readFileSync(path, 'utf-8');

const R = [
  ['\'복호화 실패\'',
   't(\'filesOpen.decryptFailFallback\')'],
  ['\'잠금 해제 실패\'',
   't(\'filesOpen.unlockFailFallback\')'],
  ['\'✓ 키 잠금 해제 완료\'',
   't(\'filesOpen.keyUnlocked\')'],
  ['\'파일 추출 완료\'',
   't(\'filesOpen.filesExtracted\')'],
  ['`${files.length}개 파일`',
   't(\'filesOpen.fileCount\', { n: files.length })'],
  ['\'서명자 인증서\'',
   't(\'filesOpen.signerCert\')'],
  ['\'알 수 없는 서명자\'',
   't(\'filesOpen.unknownSigner\')'],
  ['\'서명 검증 실패\'',
   't(\'filesOpen.signatureVerifyFailed\')'],
  ['\'파일 분석 중...\'',
   't(\'filesOpen.analyzing\')'],
  [' (나)',
   ' \' + t(\'filesOpen.me\') + \''],
  ['`🔐 "${myMatch!.name}" — ${t(\'filesOpen.biometricTrying\')}`',
   't(\'filesOpen.biometricTryingFor\', { name: myMatch!.name })'],
  ['`🔐 "${myMatch.name}"의 생체 인증을 시도합니다...`',
   't(\'filesOpen.biometricTryingFor\', { name: myMatch.name })'],
  ['`"${myMatch!.name}"의 PIN(4~6자리) 또는 비밀번호를 입력하세요`',
   't(\'filesOpen.enterPinOrPasswordFor\', { name: myMatch!.name })'],
  ['`"${myMatch!.name}"의 비밀번호를 입력하세요`',
   't(\'filesOpen.enterPasswordFor\', { name: myMatch!.name })'],
  ['\'PIN 또는 비밀번호\'',
   't(\'filesOpen.pinOrPwdPlaceholder\')'],
];

let applied = 0;
for (const [from, to] of R) {
  const before = src;
  src = src.split(from).join(to);
  if (before !== src) applied++;
}
writeFileSync(path, src);
console.log('applied:', applied, '/', R.length);

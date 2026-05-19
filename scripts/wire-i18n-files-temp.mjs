#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/pages/FilesTempPage.tsx';
let src = readFileSync(path, 'utf-8');

const REPLACEMENTS = [
  ['alert(\'유효한 .pki 파일이 아닙니다.\')',
   'alert(t(\'filesOpen.invalidFile\'))'],
  ['label: \'.pki 파일 분석\'',
   'label: t(\'filesOpen.analyzeLabel\')'],
  ['`파일 크기: ${formatSize(rawData.length)}`',
   '`${t(\'filesOpen.fileSize\')}: ${formatSize(rawData.length)}`'],
  ['isComp && \'압축\'',
   'isComp && t(\'filesOpen.flagsCompress\')'],
  ['isSig && \'서명\'',
   'isSig && t(\'filesOpen.flagsSigned\')'],
  ['isEnc && \'암호화\'',
   'isEnc && t(\'filesOpen.flagsEncrypted\')'],
  ['`플래그: ${',
   '`${t(\'filesOpen.flags\')}: ${'],
  ['`알고리즘: ${detectedAlgos',
   '`${t(\'filesOpen.algorithms\')}: ${detectedAlgos'],
  ['const encLabel = isPw ? \'비밀번호 복호화\'',
   'const encLabel = isPw ? t(\'filesOpen.decryptPassword\')'],
  ['? \'개인키 복호화 (ML-KEM)\' : \'개인키 복호화 (ECDH)\'',
   '? t(\'filesOpen.decryptKem\') : t(\'filesOpen.decryptEcdh\')'],
  ['prompt: \'비밀번호를 입력하세요\'',
   'prompt: t(\'filesOpen.enterPassword\')'],
  ['placeholder: \'비밀번호\'',
   'placeholder: t(\'filesOpen.passwordPlaceholder\')'],
  ['`✓ 복호화 성공 (${formatSize(decrypted.byteLength)})`',
   '`${t(\'filesOpen.decryptSuccess\')} (${formatSize(decrypted.byteLength)})`'],
  ['\'✗ 비밀번호가 틀렸습니다\'',
   't(\'filesOpen.pwWrong\')'],
  ['question: \'다시 시도하시겠습니까?\'',
   'question: t(\'filesOpen.retryQuestion\')'],
  ['label: \'다시 입력\'',
   'label: t(\'filesOpen.retryAgain\')'],
  ['label: \'취소\', onClick:',
   'label: t(\'filesOpen.cancel\'), onClick:'],
  ['`내부에 ${inner.signatures.length}개의 서명이 포함되어 있습니다`',
   't(\'filesOpen.innerSignatures\', { n: inner.signatures.length })'],
  ['\'PQC Only 암호화 (ML-KEM-1024)\'',
   't(\'filesOpen.pqcOnly\')'],
  ['`이 파일은 ${recipients.length}명의 수신자 공개키로 암호화되었습니다.`',
   't(\'filesOpen.recipientList\', { n: recipients.length })'],
  ['\'알 수 없는 수신자\'',
   't(\'filesOpen.recipientUnknown\')'],
  ['\'✗ 이 파일의 수신자 목록에 본인의 키가 없습니다.\'',
   't(\'filesOpen.noMatchingKey\')'],
  ['`🔐 "${myMatch!.name}"의 생체 인증을 시도합니다...`',
   '`🔐 "${myMatch!.name}" — ${t(\'filesOpen.biometricTrying\')}`'],
  ['\'✓ 생체 인증 성공\'',
   't(\'filesOpen.biometricOk\')'],
  ['\'생체 인증 취소 — PIN/비밀번호로 진행합니다\'',
   't(\'filesOpen.biometricCancel\')'],
  ['`✓ ML-DSA-87 양자 서명 유효`',
   't(\'filesOpen.pqcVerifyOk\')'],
  ['`✗ ML-DSA-87 양자 서명 무효`',
   't(\'filesOpen.pqcVerifyFail\')'],
  ['\'ML-DSA 서명이 포함되어 있지만 PQC 키가 없어 검증하지 못했습니다\'',
   't(\'filesOpen.pqcKeyMissing\')'],
  ['\'ML-KEM 암호화가 포함되어 있지만 PQC 키가 없어 검증하지 못했습니다\'',
   't(\'filesOpen.pqcKemKeyMissing\')'],
  ['\'PQC 서명 검증 모듈 로드 실패 — 양자 서명은 검증되지 않습니다\'',
   't(\'filesOpen.pqcLoadFail\')'],
  ['`✓ "${myMatch!.name}" 개인키로 복호화 성공`',
   '`✓ "${myMatch!.name}" — ${t(\'filesOpen.keyDecryptSuccess\')}`'],
  ['label: \'서명 검증\'',
   'label: t(\'filesOpen.signedOnlyStep\')'],
];

let applied = 0;
for (const [from, to] of REPLACEMENTS) {
  const before = src;
  src = src.split(from).join(to);
  if (before !== src) applied++;
}
writeFileSync(path, src);
console.log('applied:', applied, '/', REPLACEMENTS.length);

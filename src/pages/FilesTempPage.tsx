'use client';

/**
 * FilesTempPage — TaskStream UI 실험 페이지
 *
 * 실제 .pki 파일을 열고, 단계별 처리 과정을 Claude Code 스타일
 * TaskStream UI로 실시간 표시한다.
 */
import { useState, useRef, useCallback } from 'react';
import { TaskStream, useTaskStream, type StreamItem } from '@/components/TaskStream';
import { FolderOpen, Trash2 } from 'lucide-react';
import { PqcBadge } from '@/components/PqcBadge';
import {
  isPkiFile, readPkiContainer, hasFlag,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, FLAG_SIGNED,
  deserializeSignerInfos, base64ToArrayBuffer,
} from '@/lib/container/pki-format';
import { decryptWithPassword } from '@/lib/crypto/encryption';
import { verifyAllSignatures, computeHash, type SignedPackage } from '@/lib/crypto/signing';
import { deserializeEntries } from '@/lib/compression/compressor';
import { unpackInnerPayload } from '@/lib/container/inner-payload';
import { open as openPki } from '@/lib/container/pki-operations';
import { getCertificate } from '@/lib/crypto/key-manager';
import { useAppStore } from '@/lib/store/app-store';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function FilesTempPage() {
  const { keyIdentity } = useAppStore();
  const { items, push, update, reset } = useTaskStream();
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPqcFile, setIsPqcFile] = useState(false);
  const [processing, setProcessing] = useState(false);
  const rawDataRef = useRef<Uint8Array | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 파일 선택 ===
  const handleOpen = useCallback(async (file: File) => {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isPkiFile(data)) { alert('유효한 .pki 파일이 아닙니다.'); return; }

    rawDataRef.current = data;
    setFileName(file.name);
    reset();
    runAnalysis(data);
  }, [reset]);

  // === 메인 분석 흐름 ===
  const runAnalysis = useCallback(async (rawData: Uint8Array) => {
    setProcessing(true);
    const container = readPkiContainer(rawData);
    const h = container.header;
    const isEnc = hasFlag(h.flags, FLAG_ENCRYPTED);
    const isSig = hasFlag(h.flags, FLAG_SIGNED);
    const isComp = hasFlag(h.flags, FLAG_COMPRESSED);
    const isPw = isEnc && h.encryption?.recipients[0]?.fingerprint === 'password';

    // PQC 헤더 감지 (pqcHeader가 header에 포함되어 있을 수 있음)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pqcHeader = (h as any).pqcHeader;
    const hasPqc = !!pqcHeader?.pqcProtected;
    setIsPqcFile(hasPqc);

    const id = () => crypto.randomUUID();

    // Step 1: 파일 분석
    const analyzeId = id();
    push({ type: 'step', id: analyzeId, label: '.pki 파일 분석', status: 'active' });
    await sleep(500);
    push({ type: 'text', id: id(), content: `파일 크기: ${formatSize(rawData.length)}`, tone: 'muted' });
    push({ type: 'text', id: id(), content: `플래그: ${[isComp && '압축', isSig && '서명', isEnc && '암호화'].filter(Boolean).join(', ')}`, tone: 'muted' });

    // 감지된 알고리즘 표시
    const detectedAlgos: string[] = [];
    if (isComp) detectedAlgos.push(h.compression?.method === 'zip' ? 'ZIP' : 'ZLIB');
    if (isEnc) detectedAlgos.push(isPw ? 'AES-256-GCM (비밀번호)' : 'ECDH P-256 + AES-256-GCM');
    if (isSig) detectedAlgos.push('ECDSA P-256');
    if (h.pqcKemRecipientInfo) detectedAlgos.push('ML-KEM-1024 (양자 암호화)');
    if (h.pqcSignerInfo) detectedAlgos.push('ML-DSA-87 (양자 서명)');
    if (hasPqc && !h.pqcKemRecipientInfo && !h.pqcSignerInfo) {
      detectedAlgos.push(`${pqcHeader.kemAlgorithm || 'ML-KEM'} + ${pqcHeader.dsaAlgorithm || 'ML-DSA'}`);
    }
    push({ type: 'text', id: id(), content: `알고리즘: ${detectedAlgos.join(', ')}`, tone: 'muted' });

    update(analyzeId, { status: 'done' });

    await sleep(300);

    // Step 2: 암호화 해제
    if (isEnc) {
      const encId = id();
      push({ type: 'step', id: encId, label: isPw ? '비밀번호 복호화' : '개인키 복호화 (ECDH)', status: 'active' });

      if (isPw) {
        const pwId = id();
        // 비밀번호 입력 대기
        await new Promise<void>((resolve) => {
          push({
            type: 'input', id: pwId, kind: 'password',
            prompt: '비밀번호를 입력하세요',
            placeholder: '비밀번호',
            onSubmit: async (pw) => {
              try {
                const iv = new Uint8Array(base64ToArrayBuffer(h.encryption!.iv));
                const salt = new Uint8Array(base64ToArrayBuffer(h.encryption!.recipients[0]?.wrappedKey || ''));
                const payloadBuf = new ArrayBuffer(container.payload.byteLength);
                new Uint8Array(payloadBuf).set(container.payload);
                const decrypted = await decryptWithPassword(payloadBuf, pw, iv, salt);

                update(encId, { status: 'done' });
                push({ type: 'text', id: id(), content: `✓ 복호화 성공 (${formatSize(decrypted.byteLength)})`, tone: 'success' });

                // Inner payload 파싱 → 서명 발견 여부
                try {
                  const inner = unpackInnerPayload(decrypted);
                  if (inner.signatures?.length) {
                    push({ type: 'text', id: id(), content: `내부에 ${inner.signatures.length}개의 서명이 포함되어 있습니다`, tone: 'warning' });
                    await verifyInnerSignatures(inner.signatures, inner.data, push, update);
                    let files = deserializeEntries(inner.data);
                    files = restoreFileNames(files, h);
                    showFiles(files, push, update);
                  } else {
                    let files = deserializeEntries(inner.data);
                    files = restoreFileNames(files, h);
                    showFiles(files, push, update);
                  }
                } catch {
                  let files = deserializeEntries(decrypted);
                  files = restoreFileNames(files, h);
                  showFiles(files, push, update);
                }
                resolve();
              } catch {
                update(encId, { status: 'error' });
                push({ type: 'text', id: id(), content: '✗ 비밀번호가 틀렸습니다', tone: 'error' });
                push({
                  type: 'options', id: id(),
                  question: '다시 시도하시겠습니까?',
                  options: [
                    { label: '다시 입력', variant: 'primary', onClick: () => { reset(); runAnalysis(rawData); } },
                    { label: '취소', onClick: () => setProcessing(false) },
                  ],
                });
                resolve();
              }
            },
          });
        });
      } else {
        // === Enveloped: 수신자 카드 → 생체/PIN/비밀번호 잠금 해제 → 개인키 ECDH 복호화 ===
        const recipients = h.encryption?.recipients ?? [];
        push({ type: 'text', id: id(), content: `이 파일은 ${recipients.length}명의 수신자 공개키로 암호화되었습니다.`, tone: 'muted' });

        const { getAllKeyRingEntries, getAllIdentityMetas, loadIdentitySeed } = await import('@/lib/crypto/key-manager');
        const { hasBiometric, unlockWithBiometric } = await import('@/lib/crypto/biometric');
        const { hasPin, unlockWithPin } = await import('@/lib/crypto/pin');
        const { deriveKeyIdentity } = await import('@/lib/crypto/hd-key');
        const ring = await getAllKeyRingEntries();
        const myIdentities = await getAllIdentityMetas();

        // 수신자 카드 표시 + 내 키 매칭 찾기
        let myMatch: { id: string; name: string } | null = null;

        for (const r of recipients) {
          const entry = ring.find(e => e.fingerprint === r.fingerprint);
          const meta = myIdentities.find(m => m.signingFingerprint === r.fingerprint);
          const isMe = !!meta || entry?.type === 'local';
          const cert = await getCertificate(r.fingerprint).catch(() => null);

          push({
            type: 'cert', id: id(),
            name: (cert?.commonName || entry?.label || r.label || '알 수 없는 수신자') + (isMe ? ' (나)' : ''),
            email: cert?.email,
            fingerprint: r.fingerprint,
            issuedAt: cert?.notBefore,
            expiresAt: cert?.notAfter,
            logotype: cert?.logotype,
          });

          if (isMe && meta) {
            myMatch = { id: meta.id, name: meta.name };
          }
        }

        // 수신자 중 내 키가 없음
        if (!myMatch) {
          update(encId, { status: 'error' });
          push({ type: 'text', id: id(), content: '✗ 이 파일의 수신자 목록에 본인의 키가 없습니다.', tone: 'error' });
          setProcessing(false);
          return;
        }

        await sleep(200);

        // 복호화 실행 함수 (키가 활성화된 후 호출)
        const runDecrypt = async (activeKey: NonNullable<typeof keyIdentity>): Promise<boolean> => {
          try {
            // PQC 모듈 로드 (ML-DSA 검증용 — 공개키만 필요)
            let pqcOpts: Parameters<typeof openPki>[3] | undefined;
            try {
              if (h.pqcSignerInfo) {
                const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
                const dsaPub = new Uint8Array(base64ToArrayBuffer(h.pqcSignerInfo.dsaPublicKey));
                pqcOpts = { signer: PQCSigner.fromBundle({ publicKey: dsaPub, secretKey: new Uint8Array(0) }) };
              }
            } catch { /* PQC 미사용 */ }

            const result = await openPki(rawData, activeKey.encryptionKey.privateKey, activeKey.encryptionKey.fingerprint, pqcOpts);
            update(encId, { status: 'done' });
            push({ type: 'text', id: id(), content: `✓ "${myMatch!.name}" 개인키로 복호화 성공`, tone: 'success' });
            if (result.pqcVerification) {
              push({ type: 'text', id: id(), content: result.pqcVerification.valid
                ? `✓ ML-DSA-87 양자 서명 유효`
                : `✗ ML-DSA-87 양자 서명 무효`, tone: result.pqcVerification.valid ? 'success' : 'error' });
            }
            if (result.verification.length > 0) {
              await showVerificationResults(result.verification, push);
            }
            showFiles(result.files, push, update);
            return true;
          } catch (err) {
            update(encId, { status: 'error' });
            push({ type: 'text', id: id(), content: `✗ ${err instanceof Error ? err.message : '복호화 실패'}`, tone: 'error' });
            return false;
          }
        };

        // 1. 이미 메모리에 키가 있고 매칭되면 바로 복호화
        if (keyIdentity) {
          await runDecrypt(keyIdentity);
          setProcessing(false);
          return;
        }

        // 2. 생체 인증 자동 시도
        const bioAvailable = await hasBiometric(myMatch.id);
        if (bioAvailable) {
          push({ type: 'text', id: id(), content: `🔐 "${myMatch.name}"의 생체 인증을 시도합니다...`, tone: 'muted' });
          try {
            const seed = await unlockWithBiometric(myMatch.id);
            const activeKey = await deriveKeyIdentity(seed);
            useAppStore.getState().setKeyIdentity(activeKey);
            useAppStore.getState().setActiveIdentityId(myMatch.id);
            push({ type: 'text', id: id(), content: '✓ 생체 인증 성공', tone: 'success' });
            await runDecrypt(activeKey);
            setProcessing(false);
            return;
          } catch {
            push({ type: 'text', id: id(), content: '생체 인증 취소 — PIN/비밀번호로 진행합니다', tone: 'muted' });
          }
        }

        // 3. PIN/비밀번호 입력 요청
        const pinAvailable = await hasPin(myMatch.id);
        const inputId = id();

        const requestInput = () => new Promise<void>((resolve) => {
          push({
            type: 'input', id: inputId,
            kind: pinAvailable ? 'pin' : 'password',
            prompt: pinAvailable
              ? `"${myMatch!.name}"의 PIN(4~6자리) 또는 비밀번호를 입력하세요`
              : `"${myMatch!.name}"의 비밀번호를 입력하세요`,
            placeholder: pinAvailable ? 'PIN 또는 비밀번호' : '비밀번호',
            onSubmit: async (value) => {
              try {
                let seed: Uint8Array;
                if (pinAvailable && /^\d{4,6}$/.test(value)) {
                  seed = await unlockWithPin(myMatch!.id, value);
                } else {
                  seed = await loadIdentitySeed(myMatch!.id, value);
                }
                const activeKey = await deriveKeyIdentity(seed);
                useAppStore.getState().setKeyIdentity(activeKey);
                useAppStore.getState().setActiveIdentityId(myMatch!.id);
                push({ type: 'text', id: id(), content: '✓ 키 잠금 해제 완료', tone: 'success' });
                await runDecrypt(activeKey);
                resolve();
              } catch (err) {
                push({ type: 'text', id: id(), content: `✗ ${err instanceof Error ? err.message : '잠금 해제 실패'}`, tone: 'error' });
                push({
                  type: 'options', id: id(),
                  question: '다시 시도하시겠습니까?',
                  options: [
                    { label: '다시 입력', variant: 'primary', onClick: () => { reset(); runAnalysis(rawData); } },
                    { label: '취소', onClick: () => setProcessing(false) },
                  ],
                });
                resolve();
              }
            },
          });
        });

        await requestInput();
      }
    } else if (isSig) {
      // 서명만
      const sigId = id();
      push({ type: 'step', id: sigId, label: '서명 검증', status: 'active' });
      if (h.signatures?.length) {
        const signerInfos = deserializeSignerInfos(h.signatures);
        const contentHash = computeHash(container.payload);
        const pkg: SignedPackage = { contentHash, signerInfos, digestAlgorithm: 'SHA-256' };
        const results = await verifyAllSignatures(container.payload, pkg);
        update(sigId, { status: results.every(r => r.valid) ? 'done' : 'error' });
        await showVerificationResults(results, push);
      }
      let files = deserializeEntries(container.payload);
      files = restoreFileNames(files, h);
      showFiles(files, push, update);
    } else {
      // 압축만
      let files = deserializeEntries(container.payload);
      files = restoreFileNames(files, h);
      showFiles(files, push, update);
    }

    setProcessing(false);
  }, [push, update, reset, keyIdentity]);

  const clearAll = () => {
    reset();
    setFileName(null);
    rawDataRef.current = null;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">PKIZIP 파일 열기</h1>
          <p className="text-sm text-zinc-500">.pki 파일을 열어 단계별로 분석합니다.</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1.5 text-sm border border-zinc-200 rounded-xl px-3 py-2 hover:bg-zinc-50">
              <Trash2 className="w-4 h-4" /> 초기화
            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()} disabled={processing}
            className="flex items-center gap-1.5 text-sm bg-zinc-900 text-white rounded-xl px-4 py-2 disabled:opacity-50">
            <FolderOpen className="w-4 h-4" /> .pki 열기
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".pki" className="hidden"
        onChange={e => { if (e.target.files?.[0]) handleOpen(e.target.files[0]); e.target.value = ''; }} />

      {fileName && (
        <div className="mb-6 px-4 py-2 bg-zinc-100 rounded-xl flex items-center gap-2 text-sm">
          <FolderOpen className="w-4 h-4 text-zinc-500" />
          <PqcBadge pqc={isPqcFile} size="sm" />
          <span className="font-mono text-zinc-700 truncate">{fileName}</span>
        </div>
      )}

      {items.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-zinc-200 rounded-xl py-12 text-center text-zinc-400 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors"
        >
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">.pki 파일을 선택하거나 드래그하세요</p>
          <p className="text-xs mt-1 opacity-70">파일을 열면 단계별로 분석합니다</p>
        </button>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6">
          <TaskStream items={items} streamDelay={0} />
        </div>
      )}

      {/* 데모 버튼 제거됨 — 아래는 사용하지 않는 코드 방지용 */}
      {false && (
        <div className="hidden">
          {/* runDemo 참조 유지 (빌드 에러 방지) */}
          <button onClick={() => runDemo(push, update)}>
            unused
          </button>
        </div>
      )}
    </div>
  );
}

// === 파일 목록 표시 ===
function showFiles(files: { name: string; data: Uint8Array; size: number; type: string }[],
  push: (item: StreamItem) => void, _update: (id: string, patch: Partial<StreamItem>) => void) {
  const id = () => crypto.randomUUID();
  push({ type: 'step', id: id(), label: '파일 추출 완료', status: 'done', detail: `${files.length}개 파일` });
  for (const f of files) {
    push({ type: 'text', id: id(), content: `• ${f.name}  (${formatSize(f.size)})` });
  }
  push({
    type: 'options', id: id(),
    options: files.map(f => ({
      label: `↓ ${f.name}`,
      onClick: () => {
        const blob = new Blob([f.data.slice()], { type: f.type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = f.name;
        a.click();
      },
    })),
  });
}

// === 서명 검증 + 인증서 카드 표시 ===
async function showVerificationResults(
  results: Array<{ fingerprint: string; label?: string; valid: boolean; timestamp: number }>,
  push: (item: StreamItem) => void,
) {
  const id = () => crypto.randomUUID();
  push({ type: 'step', id: id(), label: '서명자 인증서', status: 'done' });
  for (const v of results) {
    const cert = await getCertificate(v.fingerprint).catch(() => null);
    push({
      type: 'cert', id: id(),
      name: cert?.commonName || v.label || '알 수 없는 서명자',
      email: cert?.email,
      fingerprint: v.fingerprint,
      valid: v.valid,
      issuedAt: cert?.notBefore,
      expiresAt: cert?.notAfter,
      logotype: cert?.logotype,
    });
  }
}

// === 내부 서명 검증 ===
async function verifyInnerSignatures(signatures: NonNullable<import('@/lib/container/pki-format').PkiHeader['signatures']>,
  data: Uint8Array, push: (item: StreamItem) => void, update: (id: string, patch: Partial<StreamItem>) => void) {
  const id = () => crypto.randomUUID();
  const sigId = id();
  push({ type: 'step', id: sigId, label: '서명 검증', status: 'active' });
  try {
    const signerInfos = deserializeSignerInfos(signatures);
    const contentHash = computeHash(data);
    const pkg: SignedPackage = { contentHash, signerInfos, digestAlgorithm: 'SHA-256' };
    const results = await verifyAllSignatures(data, pkg);
    update(sigId, { status: results.every(r => r.valid) ? 'done' : 'error' });
    await showVerificationResults(results, push);
  } catch {
    update(sigId, { status: 'error' });
    push({ type: 'text', id: id(), content: '서명 검증 실패', tone: 'error' });
  }
}

// === 데모 시나리오 ===
async function runDemo(push: (item: StreamItem) => void, update: (id: string, patch: Partial<StreamItem>) => void) {
  const id = () => crypto.randomUUID();
  const step1 = id();
  push({ type: 'step', id: step1, label: '파일 분석 중...', status: 'active' });
  await sleep(800);
  push({ type: 'text', id: id(), content: '파일 크기: 2.4 MB', tone: 'muted' });
  push({ type: 'text', id: id(), content: '플래그: 압축 + 서명 + 암호화', tone: 'muted' });
  update(step1, { status: 'done', label: '파일 분석 완료' });

  await sleep(500);
  const step2 = id();
  push({ type: 'step', id: step2, label: '비밀번호 복호화', status: 'active' });
  await sleep(300);

  push({
    type: 'input', id: id(), kind: 'password',
    prompt: '파일 비밀번호를 입력하세요 (데모: 아무 값)',
    placeholder: '비밀번호',
    onSubmit: async (_v) => {
      update(step2, { status: 'done' });
      push({ type: 'text', id: id(), content: '✓ 복호화 성공', tone: 'success' });

      await sleep(400);
      const step3 = id();
      push({ type: 'step', id: step3, label: '서명 검증', status: 'active' });
      await sleep(600);
      update(step3, { status: 'done' });

      push({
        type: 'cert', id: id(),
        name: '홍길동',
        email: 'hong@example.com',
        fingerprint: 'demo3a7fc2d1',
        valid: true,
        issuedAt: Date.now() - 86400000 * 30,
        expiresAt: Date.now() + 86400000 * 365 * 10,
      });

      await sleep(400);
      push({ type: 'step', id: id(), label: '압축 해제 완료', status: 'done' });
      push({ type: 'text', id: id(), content: '3개 파일을 찾았습니다', tone: 'success' });
      push({ type: 'text', id: id(), content: '• 계약서.pdf  (2.4 MB)' });
      push({ type: 'text', id: id(), content: '• 설계서.docx  (1.1 MB)' });
      push({ type: 'text', id: id(), content: '• image.png  (3.2 MB)' });

      push({
        type: 'options', id: id(),
        question: '다음 작업을 선택하세요',
        options: [
          { label: '전체 추출', variant: 'primary', onClick: () => alert('(데모) 전체 추출') },
          { label: '선택 추출', onClick: () => alert('(데모) 선택 추출') },
          { label: '다른 파일 열기', onClick: () => alert('(데모) 파일 선택') },
        ],
      });
    },
  });
}

// === 헤더에서 파일명/타입 복원 (ZLIB 단일 파일 등) ===
function restoreFileNames(
  files: { name: string; data: Uint8Array; size: number; type: string; lastModified: number }[],
  header: import('@/lib/container/pki-format').PkiHeader
) {
  if (files.length === 1 && header.files.length >= 1) {
    const meta = header.files[0];
    files[0].name = meta.name || files[0].name;
    files[0].type = meta.type || files[0].type;
  }
  if (files.length > 1 && header.files.length === files.length) {
    return files.map((f, i) => ({
      ...f,
      name: header.files[i]?.name ?? f.name,
      type: header.files[i]?.type ?? f.type,
    }));
  }
  return files;
}

function formatSize(b: number) {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`;
}

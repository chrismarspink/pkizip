'use client';

/**
 * FilesTempPage — TaskStream UI 실험 페이지
 *
 * 실제 .pki 파일을 열고, 단계별 처리 과정을 Claude Code 스타일
 * TaskStream UI로 실시간 표시한다.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
// helper 함수 (hook 외부) 용 — singleton t
const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;
import { TaskStream, useTaskStream, type StreamItem } from '@/components/TaskStream';
import { FolderOpen, Trash2 } from 'lucide-react';
import { takePendingFile } from '@/lib/store/pending-file';
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
import { open as openPki, verifyContainerTimestamp } from '@/lib/container/pki-operations';
import type { TstVerifyResult } from '@/lib/tsa-verify';
import { getCertificate, getFromKeyRing, addToKeyRing } from '@/lib/crypto/key-manager';
import { useAppStore } from '@/lib/store/app-store';
import { toast } from 'sonner';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function FilesTempPage() {
  const { t } = useTranslation();
  const { keyIdentity, activeIdentityId, setActiveIdentityId } = useAppStore();
  const { items, push, update, reset } = useTaskStream();
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPqcFile, setIsPqcFile] = useState(false);
  const [processing, setProcessing] = useState(false);
  const rawDataRef = useRef<Uint8Array | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 파일 선택 ===
  const handleOpen = useCallback(async (file: File) => {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isPkiFile(data)) { alert(t('filesOpen.invalidFile')); return; }

    rawDataRef.current = data;
    setFileName(file.name);
    reset();
    runAnalysis(data);
  }, [reset]);

  // 다른 페이지 (Explorer 등) 에서 setPendingFile() 로 던진 파일 자동 분석.
  // 마운트 시 한 번만 — takePendingFile() 가 값을 소비하므로 재실행 안전.
  useEffect(() => {
    const pending = takePendingFile();
    if (pending) handleOpen(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 활성 ID 가 없으면 기본 인증서로 자동 선택 (CertsPage 와 일관성 유지)
  useEffect(() => {
    if (activeIdentityId) return;
    (async () => {
      const { getDefaultIdentityId } = await import('@/lib/crypto/key-manager');
      const def = await getDefaultIdentityId();
      if (def) setActiveIdentityId(def);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // TSA 결과 표시 — 모든 분기 공통 (push 와 id 클로저 접근)
    // i18n 4언어 적용 — date locale 도 사용자 언어 따름
    const pushTimestampResult = (tv: TstVerifyResult) => {
      // i18next 의 현재 언어를 navigator-style locale 로 (ko/en/ja/zh → ko-KR/en-US/ja-JP/zh-CN)
      const langMap: Record<string, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };
      const dateLocale = langMap[(typeof window !== 'undefined' && localStorage.getItem('pkizip_lang')) || 'ko'] || 'en-US';
      if (tv.method === 'tst' && tv.valid) {
        push({
          type: 'text', id: id(),
          content: `${t('filesOpen.tsaValid')}${tv.genTime ? ' · ' + tv.genTime.toLocaleString(dateLocale) : ''}${tv.tsaName ? ' (' + tv.tsaName + ')' : ''}`,
          tone: 'success',
        });
      } else if (tv.method === 'tst' && !tv.valid) {
        push({
          type: 'text', id: id(),
          content: `${t('filesOpen.tsaInvalid')}: ${tv.errors.map(e => e.message).join(', ')}`,
          tone: 'error',
        });
      } else if (tv.method === 'signingTime') {
        push({
          type: 'text', id: id(),
          content: `${t('filesOpen.tsaSigningTime')}${tv.genTime ? ' · ' + tv.genTime.toLocaleString(dateLocale) : ''} ${t('filesOpen.tsaSigningTimeUnreliable')}`,
          tone: 'warning',
        });
      }
      if (tv.warnings.length > 0) {
        push({ type: 'text', id: id(), content: tv.warnings.join('; '), tone: 'muted' });
      }
    };

    // Step 1: 파일 분석
    const analyzeId = id();
    push({ type: 'step', id: analyzeId, label: t('filesOpen.analyzeLabel'), status: 'active' });
    await sleep(500);
    push({ type: 'text', id: id(), content: `${t('filesOpen.fileSize')}: ${formatSize(rawData.length)}`, tone: 'muted' });
    push({ type: 'text', id: id(), content: `${t('filesOpen.flags')}: ${[isComp && t('filesOpen.flagsCompress'), isSig && t('filesOpen.flagsSigned'), isEnc && t('filesOpen.flagsEncrypted')].filter(Boolean).join(', ')}`, tone: 'muted' });

    // 감지된 알고리즘 표시 (헤더 내용 기반)
    const detectedAlgos: string[] = [];
    const ecdhRecipients = h.encryption?.recipients?.filter(r => r.fingerprint !== 'password') ?? [];
    const pqcKemPresent = !!h.pqcKemRecipientInfo;
    const pqcDsaPresent = !!h.pqcSignerInfo;
    const ecdsaPresent = (h.signatures?.length ?? 0) > 0;

    if (isComp) detectedAlgos.push(h.compression?.method === 'zip' ? 'ZIP' : 'ZLIB');
    if (isPw) detectedAlgos.push('AES-256-GCM (비밀번호)');
    if (ecdhRecipients.length > 0) detectedAlgos.push('ECDH P-256 + AES-256-GCM');
    if (pqcKemPresent) detectedAlgos.push('ML-KEM-1024 (양자 암호화)');
    if (ecdsaPresent) detectedAlgos.push('ECDSA P-256 (서명)');
    if (pqcDsaPresent) detectedAlgos.push('ML-DSA-87 (양자 서명)');
    // 암호화되어 있는데 ECDH도 ML-KEM도 없으면 AES-GCM만 표시
    if (isEnc && !isPw && ecdhRecipients.length === 0 && !pqcKemPresent) detectedAlgos.push('AES-256-GCM');

    push({ type: 'text', id: id(), content: `${t('filesOpen.algorithms')}: ${detectedAlgos.join(', ')}`, tone: 'muted' });

    update(analyzeId, { status: 'done' });

    // TSA 타임스탬프 검증 — 모든 분기 공통 (password / enveloped / signed / compressed 무관)
    // container.payload 는 변형 전 raw payload (TSA 발급 대상)
    const tsv = await verifyContainerTimestamp(h, container.payload);
    if (tsv) {
      pushTimestampResult(tsv);
    }

    await sleep(300);

    // Step 2: 암호화 해제
    if (isEnc) {
      const encId = id();
      const encLabel = isPw ? t('filesOpen.decryptPassword')
        : h.pqcKemRecipientInfo && (h.encryption?.recipients ?? []).length === 0
          ? t('filesOpen.decryptKem') : t('filesOpen.decryptEcdh');
      push({ type: 'step', id: encId, label: encLabel, status: 'active' });

      if (isPw) {
        const pwId = id();
        // 비밀번호 입력 대기
        await new Promise<void>((resolve) => {
          push({
            type: 'input', id: pwId, kind: 'password',
            prompt: t('filesOpen.enterPassword'),
            placeholder: t('filesOpen.passwordPlaceholder'),
            onSubmit: async (pw) => {
              try {
                const iv = new Uint8Array(base64ToArrayBuffer(h.encryption!.iv));
                const salt = new Uint8Array(base64ToArrayBuffer(h.encryption!.recipients[0]?.wrappedKey || ''));
                const payloadBuf = new ArrayBuffer(container.payload.byteLength);
                new Uint8Array(payloadBuf).set(container.payload);
                const decrypted = await decryptWithPassword(payloadBuf, pw, iv, salt);

                update(encId, { status: 'done' });
                push({ type: 'text', id: id(), content: `${t('filesOpen.decryptSuccess')} (${formatSize(decrypted.byteLength)})`, tone: 'success' });

                // Inner payload 파싱 → 서명 발견 여부
                try {
                  const inner = unpackInnerPayload(decrypted);
                  // 암호화 계층 안에 숨겨진 분류 등급 — 복호화 후에만 노출
                  if (inner.meta?.classification) {
                    const c = inner.meta.classification;
                    const label = c.grade === 'C' ? t('filesOpen.gradeC')
                                : c.grade === 'S' ? t('filesOpen.gradeS')
                                : t('filesOpen.gradeO');
                    push({
                      type: 'text', id: id(),
                      content: t('filesOpen.docGrade', { label, pct: Math.round((c.confidence ?? 0) * 100) }),
                      tone: c.grade === 'O' ? 'success' : 'warning',
                    });
                  }
                  if (inner.signatures?.length) {
                    push({ type: 'text', id: id(), content: t('filesOpen.innerSignatures', { n: inner.signatures.length }), tone: 'warning' });
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
                push({ type: 'text', id: id(), content: t('filesOpen.pwWrong'), tone: 'error' });
                push({
                  type: 'options', id: id(),
                  question: t('filesOpen.retryQuestion'),
                  options: [
                    { label: t('filesOpen.retryAgain'), variant: 'primary', onClick: () => { reset(); runAnalysis(rawData); } },
                    { label: t('filesOpen.cancel'), onClick: () => setProcessing(false) },
                  ],
                });
                resolve();
              }
            },
          });
        });
      } else {
        // === Enveloped: 수신자 매칭 → 잠금 해제 → 복호화 ===
        const recipients = h.encryption?.recipients ?? [];
        const hasPqcKem = !!h.pqcKemRecipientInfo;
        const isPqcOnly = hasPqcKem && recipients.length === 0;

        if (isPqcOnly) {
          push({ type: 'text', id: id(), content: t('filesOpen.pqcOnly'), tone: 'muted' });
        } else {
          push({ type: 'text', id: id(), content: t('filesOpen.recipientList', { n: recipients.length }), tone: 'muted' });
        }

        const { getAllKeyRingEntries, getAllIdentityMetas, loadIdentitySeed } = await import('@/lib/crypto/key-manager');
        const { hasBiometric, unlockWithBiometric } = await import('@/lib/crypto/biometric');
        const { hasPin, unlockWithPin } = await import('@/lib/crypto/pin');
        const { deriveKeyIdentity } = await import('@/lib/crypto/hd-key');
        const ring = await getAllKeyRingEntries();
        const myIdentities = await getAllIdentityMetas();

        // 수신자 카드 표시 + 내 키 매칭 찾기
        let myMatch: { id: string; name: string } | null = null;

        // Classic/Hybrid: ECDH recipients에서 매칭
        for (const r of recipients) {
          const entry = ring.find(e => e.fingerprint === r.fingerprint);
          const meta = myIdentities.find(m => m.signingFingerprint === r.fingerprint);
          const isMe = !!meta || entry?.type === 'local';
          const cert = await getCertificate(r.fingerprint).catch(() => null);

          push({
            type: 'cert', id: id(),
            name: (cert?.commonName || entry?.label || r.label || t('filesOpen.recipientUnknown')) + (isMe ? ' ' + t('filesOpen.me') + '' : ''),
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

        // PQC Only: ECDH 수신자 없음 → PQC KeyId로 매칭
        if (!myMatch && isPqcOnly && myIdentities.length > 0) {
          // PQC 번들의 KeyId와 헤더의 pqcKeyId 비교는 복잡하므로,
          // 아이덴티티가 있으면 첫 번째 활성 아이덴티티를 매칭 (자가 암호화)
          const { getActiveIdentityId } = await import('@/lib/crypto/key-manager');
          const activeId = await getActiveIdentityId();
          const activeMeta = myIdentities.find(m => m.id === activeId) || myIdentities[0];
          if (activeMeta) {
            const cert = await getCertificate(activeMeta.signingFingerprint).catch(() => null);
            push({
              type: 'cert', id: id(),
              name: (cert?.commonName || activeMeta.name) + ' ' + t('filesOpen.me') + '',
              email: cert?.email,
              fingerprint: activeMeta.signingFingerprint,
              issuedAt: cert?.notBefore,
              expiresAt: cert?.notAfter,
              logotype: cert?.logotype,
            });
            myMatch = { id: activeMeta.id, name: activeMeta.name };
          }
        }

        // 수신자 중 내 키가 없음
        if (!myMatch) {
          update(encId, { status: 'error' });
          push({ type: 'text', id: id(), content: t('filesOpen.noMatchingKey'), tone: 'error' });
          setProcessing(false);
          return;
        }

        await sleep(200);

        // 복호화 실행 함수 (키가 활성화된 후 호출)
        const runDecrypt = async (activeKey: NonNullable<typeof keyIdentity>): Promise<boolean> => {
          try {
            // PQC 인스턴스 (store에서 또는 헤더 공개키로 생성)
            let pqcOpts: Parameters<typeof openPki>[3] | undefined;
            const { pqcShield, pqcSigner } = useAppStore.getState();
            if (pqcShield || pqcSigner) {
              pqcOpts = { shield: pqcShield ?? undefined, signer: pqcSigner ?? undefined };
            } else if (h.pqcSignerInfo) {
              try {
                const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
                const dsaPub = new Uint8Array(base64ToArrayBuffer(h.pqcSignerInfo.dsaPublicKey));
                pqcOpts = { signer: PQCSigner.fromBundle({ publicKey: dsaPub, secretKey: new Uint8Array(0) }) };
              } catch {
                push({ type: 'text', id: id(), content: t('filesOpen.pqcLoadFail'), tone: 'warning' });
              }
            }

            const result = await openPki(rawData, activeKey.encryptionKey.privateKey, activeKey.encryptionKey.fingerprint, pqcOpts);
            update(encId, { status: 'done' });
            push({ type: 'text', id: id(), content: `✓ "${myMatch!.name}" — ${t('filesOpen.keyDecryptSuccess')}`, tone: 'success' });
            if (result.pqcVerification) {
              push({ type: 'text', id: id(), content: result.pqcVerification.valid
                ? t('filesOpen.pqcVerifyOk')
                : t('filesOpen.pqcVerifyFail'), tone: result.pqcVerification.valid ? 'success' : 'error' });
            } else if (h.pqcSignerInfo) {
              push({ type: 'text', id: id(), content: t('filesOpen.pqcKeyMissing'), tone: 'warning' });
            }
            if (h.pqcKemRecipientInfo && !pqcOpts?.shield) {
              push({ type: 'text', id: id(), content: t('filesOpen.pqcKemKeyMissing'), tone: 'warning' });
            }
            // TST 검증은 runAnalysis 초입에서 이미 표시 — 중복 제거
            if (result.verification.length > 0) {
              await showVerificationResults(result.verification, push);
            }
            showFiles(result.files, push, update);
            return true;
          } catch (err) {
            update(encId, { status: 'error' });
            push({ type: 'text', id: id(), content: `✗ ${err instanceof Error ? err.message : t('filesOpen.decryptFailFallback')}`, tone: 'error' });
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
          push({ type: 'text', id: id(), content: t('filesOpen.biometricTryingFor', { name: myMatch.name }), tone: 'muted' });
          try {
            const seed = await unlockWithBiometric(myMatch.id);
            const activeKey = await deriveKeyIdentity(seed);
            useAppStore.getState().setKeyIdentity(activeKey);
            useAppStore.getState().setActiveIdentityId(myMatch.id);
            push({ type: 'text', id: id(), content: t('filesOpen.biometricOk'), tone: 'success' });
            await runDecrypt(activeKey);
            setProcessing(false);
            return;
          } catch {
            push({ type: 'text', id: id(), content: t('filesOpen.biometricCancel'), tone: 'muted' });
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
              ? t('filesOpen.enterPinOrPasswordFor', { name: myMatch!.name })
              : t('filesOpen.enterPasswordFor', { name: myMatch!.name }),
            placeholder: pinAvailable ? t('filesOpen.pinOrPwdPlaceholder') : '비밀번호',
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

                // PQC 인스턴스 초기화 (PIN이 아닌 비밀번호일 때만 PQC 번들 로드 가능)
                if (!/^\d{4,6}$/.test(value)) {
                  try {
                    const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
                    const { PQCBundle } = await import('@/lib/pqc/pqc-bundle.js');
                    const { PQCShield } = await import('@/lib/pqc/pqc-shield.js');
                    const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
                    const bundle = await PQCKeystore.load(value, 'default', { PQCBundleClass: PQCBundle });
                    useAppStore.getState().setPqcInstances(
                      PQCShield.fromBundle(bundle.getKEMKeyPair()),
                      PQCSigner.fromBundle(bundle.getDSAKeyPair())
                    );
                  } catch { /* PQC 번들 없음 */ }
                }

                push({ type: 'text', id: id(), content: t('filesOpen.keyUnlocked'), tone: 'success' });
                await runDecrypt(activeKey);
                resolve();
              } catch (err) {
                push({ type: 'text', id: id(), content: `✗ ${err instanceof Error ? err.message : t('filesOpen.unlockFailFallback')}`, tone: 'error' });
                push({
                  type: 'options', id: id(),
                  question: t('filesOpen.retryQuestion'),
                  options: [
                    { label: t('filesOpen.retryAgain'), variant: 'primary', onClick: () => { reset(); runAnalysis(rawData); } },
                    { label: t('filesOpen.cancel'), onClick: () => setProcessing(false) },
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
      push({ type: 'step', id: sigId, label: t('filesOpen.signedOnlyStep'), status: 'active' });
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
          <h1 className="text-xl font-bold">{t('filesOpen.title')}</h1>
          <p className="text-sm text-zinc-500">{t('filesOpen.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1.5 text-sm border border-zinc-200 rounded-xl px-3 py-2 hover:bg-zinc-50">
              <Trash2 className="w-4 h-4" /> {t('filesOpen.reset')}
            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()} disabled={processing}
            className="flex items-center gap-1.5 text-sm bg-zinc-900 text-white rounded-xl px-4 py-2 disabled:opacity-50">
            <FolderOpen className="w-4 h-4" /> {t('filesOpen.openPki')}
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
          className="w-full border-2 border-dashed border-zinc-200 rounded-xl py-12 text-center text-zinc-400 hover:border-[#175DDC] hover:text-[#175DDC] transition-colors"
        >
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">{t('filesOpen.pickerHint')}</p>
          <p className="text-xs mt-1 opacity-70">{t('filesOpen.pickerSubHint')}</p>
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
  push({ type: 'step', id: id(), label: t('filesOpen.filesExtracted'), status: 'done', detail: t('filesOpen.fileCount', { n: files.length }) });
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

/**
 * 받은 문서의 서명자를 신뢰하고 주소록에 추가 (증분 3 — 받기·신뢰).
 * 봉투에는 서명 공개키만 있으므로, 암호화 공개키는 인증서 디렉터리에서 보강한다.
 * (QrScanModal / ContactsPage 의 검증된 add 패턴 재사용)
 */
async function trustSender(fingerprint: string, name: string) {
  const existing = await getFromKeyRing(fingerprint).catch(() => null);
  if (existing) {
    if (existing.type !== 'local') toast('이미 주소록에 있는 서명자입니다.', { icon: '✅' });
    return;
  }
  try {
    const { getCertBundleByUsername } = await import('@/lib/supabase/cert-directory');
    const bundle = await getCertBundleByUsername('u-' + fingerprint.slice(0, 8)).catch(() => null);
    if (!bundle || !bundle.enc_jwk_classic) {
      toast('상대의 인증서를 찾지 못했어요 — 상대가 인증서(카드)를 공유하면 신뢰 추가할 수 있어요.', { icon: 'ℹ️', duration: 6000 });
      return;
    }
    await addToKeyRing({
      fingerprint,
      label: bundle.display_name || name,
      displayName: bundle.display_name,
      email: bundle.email,
      signingKeyJWK: {},
      encryptionKeyJWK: bundle.enc_jwk_classic,
      type: 'imported',
      certClassicPem: bundle.cert_classic,
      certKemPem: bundle.cert_kem,
      certDsaPem: bundle.cert_dsa,
      createdAt: Date.now(),
    });
    toast.success(`${bundle.display_name || name}님을 주소록에 추가했어요 — 다음부터 암호화해 보낼 수 있어요.`, { duration: 6000 });
  } catch (e) {
    toast.error(`신뢰 추가 실패: ${e instanceof Error ? e.message : '오류'}`);
  }
}

// === 서명 검증 + 인증서 카드 표시 ===
async function showVerificationResults(
  results: Array<{ fingerprint: string; label?: string; valid: boolean; timestamp: number }>,
  push: (item: StreamItem) => void,
) {
  const id = () => crypto.randomUUID();
  push({ type: 'step', id: id(), label: t('filesOpen.signerCert'), status: 'done' });
  for (const v of results) {
    const cert = await getCertificate(v.fingerprint).catch(() => null);
    const name = cert?.commonName || v.label || t('filesOpen.unknownSigner');
    push({
      type: 'cert', id: id(),
      name,
      email: cert?.email,
      fingerprint: v.fingerprint,
      valid: v.valid,
      issuedAt: cert?.notBefore,
      expiresAt: cert?.notAfter,
      logotype: cert?.logotype,
    });
    // 유효 서명이면서 주소록에 없는 서명자 → "이 사람을 신뢰할까요?" 프롬프트
    if (v.valid) {
      const known = await getFromKeyRing(v.fingerprint).catch(() => null);
      if (!known) {
        toast(`${name}님이 서명한 문서입니다. 이 서명자를 신뢰할까요?`, {
          duration: 20000,
          action: {
            label: '신뢰하고 주소록에 추가',
            onClick: () => { void trustSender(v.fingerprint, name); },
          },
        });
      }
    }
  }
}

// === 내부 서명 검증 ===
async function verifyInnerSignatures(signatures: NonNullable<import('@/lib/container/pki-format').PkiHeader['signatures']>,
  data: Uint8Array, push: (item: StreamItem) => void, update: (id: string, patch: Partial<StreamItem>) => void) {
  const id = () => crypto.randomUUID();
  const sigId = id();
  push({ type: 'step', id: sigId, label: t('filesOpen.signedOnlyStep'), status: 'active' });
  try {
    const signerInfos = deserializeSignerInfos(signatures);
    const contentHash = computeHash(data);
    const pkg: SignedPackage = { contentHash, signerInfos, digestAlgorithm: 'SHA-256' };
    const results = await verifyAllSignatures(data, pkg);
    update(sigId, { status: results.every(r => r.valid) ? 'done' : 'error' });
    await showVerificationResults(results, push);
  } catch {
    update(sigId, { status: 'error' });
    push({ type: 'text', id: id(), content: t('filesOpen.signatureVerifyFailed'), tone: 'error' });
  }
}

// === 데모 시나리오 ===
async function runDemo(push: (item: StreamItem) => void, update: (id: string, patch: Partial<StreamItem>) => void) {
  const id = () => crypto.randomUUID();
  const step1 = id();
  push({ type: 'step', id: step1, label: t('filesOpen.analyzing'), status: 'active' });
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
    placeholder: t('filesOpen.passwordPlaceholder'),
    onSubmit: async (_v) => {
      update(step2, { status: 'done' });
      push({ type: 'text', id: id(), content: '✓ 복호화 성공', tone: 'success' });

      await sleep(400);
      const step3 = id();
      push({ type: 'step', id: step3, label: t('filesOpen.signedOnlyStep'), status: 'active' });
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

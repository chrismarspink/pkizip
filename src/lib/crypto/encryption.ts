/**
 * Encryption Module - AES-256-GCM 암호화 + ECDH 다중 수신자
 *
 * CMS EnvelopedData 구조:
 *   1. 랜덤 CEK(Content Encryption Key) 생성 (AES-256)
 *   2. CEK로 데이터 암호화 (AES-256-GCM)
 *   3. 각 수신자 공개키와 ECDH → KEK → CEK 래핑
 */

// Node 23+ Uint8Array<ArrayBufferLike> → BufferSource 호환 헬퍼
const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

export interface RecipientInfo {
  fingerprint: string;
  encryptionPublicKey: CryptoKey;
  label?: string;
}

export interface WrappedRecipient {
  fingerprint: string;
  wrappedKey: ArrayBuffer;
  ephemeralPublicKey: ArrayBuffer;
  label?: string;
}

export interface EncryptedPackage {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  tag: Uint8Array;
  recipients: WrappedRecipient[];
  algorithm: 'AES-256-GCM';
  /** raw CEK bytes — PQC hybrid 캡슐화에 전달용 (메모리에서만 사용, 직렬화 안 됨) */
  rawCEK?: Uint8Array;
}

export interface DecryptionResult {
  plaintext: Uint8Array;
  recipientFingerprint: string;
}

export async function encryptForRecipients(
  data: Uint8Array,
  recipients: RecipientInfo[]
): Promise<EncryptedPackage> {
  if (recipients.length === 0) {
    throw new Error('최소 1명의 수신자가 필요합니다.');
  }

  const cek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), tagLength: 128 },
    cek,
    buf(data)
  );

  const wrappedRecipients: WrappedRecipient[] = [];
  const rawCEK = await crypto.subtle.exportKey('raw', cek);

  for (const recipient of recipients) {
    const wrapped = await wrapKeyForRecipient(rawCEK, recipient);
    wrappedRecipients.push(wrapped);
  }

  return {
    ciphertext,
    iv,
    tag: new Uint8Array(0),
    recipients: wrappedRecipients,
    algorithm: 'AES-256-GCM',
    rawCEK: new Uint8Array(rawCEK),
  };
}

async function wrapKeyForRecipient(
  rawCEK: ArrayBuffer,
  recipient: RecipientInfo
): Promise<WrappedRecipient> {
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const kek = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipient.encryptionPublicKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );

  const cekKey = await crypto.subtle.importKey(
    'raw',
    rawCEK,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const wrappedKey = await crypto.subtle.wrapKey('raw', cekKey, kek, 'AES-KW');
  const ephemeralPublicKey = await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey);

  return {
    fingerprint: recipient.fingerprint,
    wrappedKey,
    ephemeralPublicKey,
    label: recipient.label,
  };
}

export async function decryptAsRecipient(
  pkg: EncryptedPackage,
  myPrivateKey: CryptoKey,
  myFingerprint: string
): Promise<DecryptionResult> {
  // 핑거프린트로 먼저 매칭 시도, 실패 시 모든 수신자에 대해 순차 복호화 시도
  // (signingKey fingerprint로 등록되었지만 encryptionKey fingerprint로 찾는 경우 대비)
  const candidates = pkg.recipients.filter(r => r.fingerprint === myFingerprint);
  const allCandidates = candidates.length > 0 ? candidates : pkg.recipients;

  for (const recipientInfo of allCandidates) {
    try {
      const ephemeralPublicKey = await crypto.subtle.importKey(
        'raw',
        recipientInfo.ephemeralPublicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );

      const kek = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: ephemeralPublicKey },
        myPrivateKey,
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
      );

      const cek = await crypto.subtle.unwrapKey(
        'raw',
        recipientInfo.wrappedKey,
        kek,
        'AES-KW',
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf(pkg.iv), tagLength: 128 },
        cek,
        pkg.ciphertext
      );

      return {
        plaintext: new Uint8Array(plaintext),
        recipientFingerprint: recipientInfo.fingerprint,
      };
    } catch {
      // 이 수신자와 매칭 실패 → 다음 시도
      continue;
    }
  }

  throw new Error('이 파일의 수신자가 아닙니다.');
}

export async function encryptWithPassword(
  data: Uint8Array,
  password: string
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), tagLength: 128 },
    key,
    buf(data)
  );

  return { ciphertext, iv, salt };
}

export async function decryptWithPassword(
  ciphertext: ArrayBuffer,
  password: string,
  iv: Uint8Array,
  salt: Uint8Array
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(iv), tagLength: 128 },
    key,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

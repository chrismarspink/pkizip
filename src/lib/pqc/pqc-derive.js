/**
 * pqc-derive.js — 니모닉 → 3벌 키 결정론적 도출
 *
 * BIP32 확장: 하나의 니모닉에서 secp256k1 / ML-KEM-1024 / ML-DSA-87 키를
 * 알고리즘별 독립 경로로 도출합니다.
 *
 * 경로:
 *   m/44'/60'/0'/0/0     → secp256k1
 *   m/9000'/1024'/0'/0   → ML-KEM-1024 (d=privKey 32B, z=chainCode 32B)
 *   m/9000'/87'/0'/0     → ML-DSA-87 (seed=privKey 32B)
 */

import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { getPublicKey } from '@noble/secp256k1';

const PATHS = {
  ecc: "m/44'/60'/0'/0/0",
  kem: "m/9000'/1024'/0'/0",
  dsa: "m/9000'/87'/0'/0",
};

export class PQCDerive {

  static validateMnemonic(mnemonic) {
    return validateMnemonic(mnemonic, wordlist);
  }

  /**
   * 니모닉 → 3벌 키 결정론적 도출
   */
  static async deriveAll(mnemonic, password = '') {
    const seed = mnemonicToSeedSync(mnemonic, password);
    const master = HDKey.fromMasterSeed(seed);

    const ecc = PQCDerive._deriveECC(master);
    const kem = PQCDerive._deriveKEM(master);
    const dsa = PQCDerive._deriveDSA(master);

    return { ecc, kem, dsa };
  }

  static async deriveECC(mnemonic, password = '') {
    const seed = mnemonicToSeedSync(mnemonic, password);
    return PQCDerive._deriveECC(HDKey.fromMasterSeed(seed));
  }

  static async deriveKEM(mnemonic, password = '') {
    const seed = mnemonicToSeedSync(mnemonic, password);
    return PQCDerive._deriveKEM(HDKey.fromMasterSeed(seed));
  }

  static async deriveDSA(mnemonic, password = '') {
    const seed = mnemonicToSeedSync(mnemonic, password);
    return PQCDerive._deriveDSA(HDKey.fromMasterSeed(seed));
  }

  // ── 내부 도출 함수 ──

  static _deriveECC(master) {
    const node = master.derive(PATHS.ecc);
    const privateKey = node.privateKey;
    const publicKey = getPublicKey(privateKey, true); // 33B compressed
    return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(publicKey), path: PATHS.ecc };
  }

  static _deriveKEM(master) {
    // ML-KEM-1024: d(32B) + z(32B) = privKey(32B) + chainCode(32B)
    const node = master.derive(PATHS.kem);
    const d = new Uint8Array(node.privateKey);    // 32B
    const z = new Uint8Array(node.chainCode);      // 32B (독립 엔트로피)
    // ML-KEM keygen은 64B seed = d(32B) || z(32B)
    const seed64 = new Uint8Array(64);
    seed64.set(d, 0);
    seed64.set(z, 32);
    const { publicKey, secretKey } = ml_kem1024.keygen(seed64);
    return { secretKey: new Uint8Array(secretKey), publicKey: new Uint8Array(publicKey), path: PATHS.kem, _d: d, _z: z };
  }

  static _deriveDSA(master) {
    // ML-DSA-87: seed(32B) = privKey(32B)
    const node = master.derive(PATHS.dsa);
    const seed = new Uint8Array(node.privateKey);  // 32B
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    return { secretKey: new Uint8Array(secretKey), publicKey: new Uint8Array(publicKey), path: PATHS.dsa, _seed: seed };
  }
}

export { PATHS as PQC_PATHS };

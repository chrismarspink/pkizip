// PQC 모듈 타입 선언 (.js → TypeScript 호환)

declare module '@/lib/pqc/pqc-bundle.js' {
  export class PQCBundle {
    static create(opts: {
      mnemonic: string;
      password: string;
      subject: { name: string; email: string };
      mode?: string;
    }): Promise<PQCBundle>;
    static load(json: string, password: string): Promise<PQCBundle>;
    static restore(mnemonic: string, password: string, opts?: any): Promise<PQCBundle>;
    serialize(): string;
    getInfo(): any;
    getKEMKeyPair(): any;
    getDSAKeyPair(): any;
    getPqcKeyId(): string | null;
    get data(): any;
  }
}

declare module '@/lib/pqc/pqc-keystore.js' {
  export class PQCKeystore {
    static save(bundle: any, password: string, bundleId?: string): Promise<void>;
    static load(password: string, bundleId?: string, opts?: any): Promise<any>;
    static getInfo(bundleId?: string): Promise<any>;
    static exportJSON(bundleId?: string): Promise<string>;
    static importJSON(jsonStr: string, password?: string): Promise<void>;
    static changePassword(oldPw: string, newPw: string, bundleId?: string, opts?: any): Promise<void>;
  }
}

declare module '@/lib/pqc/pqc-shield.js' {
  export class PQCShield {
    static fromBundle(kemKeyPair: any): PQCShield;
    get pqcKeyId(): string;
    encapsulateCEK(cek: Uint8Array, linkedCertSerial?: string | null): Promise<any>;
    decapsulateCEK(recipientInfo: any): Promise<Uint8Array>;
    isMyRecipientInfo(ri: any): boolean;
    encryptPayload(data: Uint8Array): Promise<any>;
    decryptPayload(payload: any): Promise<Uint8Array>;
  }
}

declare module '@/lib/pqc/pqc-signer.js' {
  export class PQCSigner {
    static fromBundle(dsaKeyPair: any): PQCSigner;
    sign(data: Uint8Array): Promise<any>;
    verify(data: Uint8Array, pqcSig: any): Promise<{ valid: boolean; algorithm: string; signedAt: string; reason: string }>;
    wrapSigned(signedData: any, certId: string, dsaConfig?: any): Promise<any>;
    verifySigned(signedData: any): Promise<any>;
    signDetached(fileBytes: Uint8Array): Promise<any>;
    verifyDetached(fileBytes: Uint8Array, pqcSig: any): Promise<any>;
  }
}

declare module '@/lib/pqc/pqc-bridge.js' {
  export class PQCBridge {
    static init(opts: any): Promise<PQCBridge>;
    resolveKemConfig(certId?: string): any;
    resolveDsaConfig(certId?: string): any;
    wrapEnveloped(ed: any, certId?: string): Promise<any>;
    unwrapEnveloped(ed: any): Promise<any>;
    encryptData(data: Uint8Array, certId?: string): Promise<any>;
    decryptData(payload: any): Promise<any>;
    wrapSigned(sd: any, certId?: string): Promise<any>;
    verifySigned(sd: any): Promise<any>;
    signFile(fb: Uint8Array): Promise<any>;
    verifyFile(fb: Uint8Array, sig: any): Promise<any>;
    getBundle(): any;
    get shield(): any;
    get signer(): any;
  }
}

declare module '@/lib/pqc/pqc-derive.js' {
  export class PQCDerive {
    static deriveAll(mnemonic: string, password?: string): Promise<{
      kem: { secretKey: Uint8Array; publicKey: Uint8Array; path: string };
      dsa: { secretKey: Uint8Array; publicKey: Uint8Array; path: string };
    }>;
    static validateMnemonic(mnemonic: string): boolean;
  }
}

declare module '@/lib/pqc/pqc-banner.js' {
  export function printBundleCreateBanner(opts: any): void;
  export function printEncryptBanner(opts: any): void;
  export function printSignBanner(opts: any): void;
  export function printDecryptBanner(opts: any): void;
  export function printVerifyBanner(result: any): void;
  export function buildPqcHeader(opts: any): any;
}

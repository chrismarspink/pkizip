/**
 * App Store - 전역 애플리케이션 상태 (Zustand)
 */
import { create } from 'zustand';
import type { FileEntry } from '../compression/compressor';
import type { PkiHeader } from '../container/pki-format';
import type { KeyIdentity } from '../crypto/hd-key';
import type { VerificationResult } from '../crypto/signing';
import type { CertificateInfo } from '../crypto/certificate';

export interface ArchiveFile extends FileEntry {
  isEncrypted: boolean;
  signatureCount: number;
  hash: string;
  selected: boolean;
}

export interface IdentitySummary {
  id: string;
  name: string;
  commonName: string;
  email: string;
  signingFingerprint: string;
  encryptionFingerprint: string;
  createdAt: number;
}

interface AppState {
  // === 아이덴티티 (다중 지원) ===
  identities: IdentitySummary[];
  setIdentities: (identities: IdentitySummary[]) => void;

  activeIdentityId: string | null;
  setActiveIdentityId: (id: string | null) => void;

  keyIdentity: KeyIdentity | null;
  setKeyIdentity: (identity: KeyIdentity | null) => void;
  isKeyLoaded: boolean;

  certificate: CertificateInfo | null;
  setCertificate: (cert: CertificateInfo | null) => void;

  // === PQC 설정 ===
  pqcConfig: { kemEnabled: boolean; kemMode: string; dsaEnabled: boolean; dsaMode: string };
  setPqcConfig: (cfg: { kemEnabled: boolean; kemMode: string; dsaEnabled: boolean; dsaMode: string }) => void;

  // === 아카이브 ===
  archiveName: string | null;
  archiveHeader: PkiHeader | null;
  archiveFiles: ArchiveFile[];
  archiveRawData: Uint8Array | null;
  isArchiveModified: boolean;

  openArchive: (name: string, header: PkiHeader, files: FileEntry[], rawData: Uint8Array) => void;
  closeArchive: () => void;
  addFiles: (files: FileEntry[]) => void;
  removeSelectedFiles: () => void;
  toggleFileSelection: (name: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  setArchiveModified: (modified: boolean) => void;
  setArchiveRawData: (data: Uint8Array) => void;

  // === 검증 ===
  verificationResults: VerificationResult[];
  setVerificationResults: (results: VerificationResult[]) => void;

  // === UI ===
  detailSheetOpen: boolean;
  setDetailSheetOpen: (open: boolean) => void;

  activeDialog: string | null;
  setActiveDialog: (dialog: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // 아이덴티티
  identities: [],
  setIdentities: (identities) => set({ identities }),

  activeIdentityId: null,
  setActiveIdentityId: (activeIdentityId) => set({ activeIdentityId }),

  keyIdentity: null,
  setKeyIdentity: (keyIdentity) => set({
    keyIdentity,
    isKeyLoaded: !!keyIdentity,
  }),
  isKeyLoaded: false,

  certificate: null,
  setCertificate: (certificate) => set({ certificate }),

  // PQC 설정 (localStorage에서 초기화)
  pqcConfig: (() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('pkizip-pqc-ui-config') : null;
      if (saved) {
        const p = JSON.parse(saved);
        return { kemEnabled: p.kem?.enabled ?? true, kemMode: p.kem?.mode ?? 'hybrid', dsaEnabled: p.dsa?.enabled ?? true, dsaMode: p.dsa?.mode ?? 'hybrid' };
      }
    } catch {}
    return { kemEnabled: true, kemMode: 'hybrid', dsaEnabled: true, dsaMode: 'hybrid' };
  })(),
  setPqcConfig: (pqcConfig) => {
    set({ pqcConfig });
    try { localStorage.setItem('pkizip-pqc-ui-config', JSON.stringify({ kem: { enabled: pqcConfig.kemEnabled, mode: pqcConfig.kemMode }, dsa: { enabled: pqcConfig.dsaEnabled, mode: pqcConfig.dsaMode } })); } catch {}
  },

  // 아카이브
  archiveName: null,
  archiveHeader: null,
  archiveFiles: [],
  archiveRawData: null,
  isArchiveModified: false,

  openArchive: (name, header, files, rawData) => set({
    archiveName: name,
    archiveHeader: header,
    archiveFiles: files.map(f => ({
      ...f,
      isEncrypted: !!(header.encryption),
      signatureCount: header.signatures?.length ?? 0,
      hash: '',
      selected: false,
    })),
    archiveRawData: rawData,
    isArchiveModified: false,
  }),

  closeArchive: () => set({
    archiveName: null,
    archiveHeader: null,
    archiveFiles: [],
    archiveRawData: null,
    isArchiveModified: false,
    verificationResults: [],
  }),

  addFiles: (files) => {
    const current = get().archiveFiles;
    const newFiles: ArchiveFile[] = files.map(f => ({
      ...f,
      isEncrypted: false,
      signatureCount: 0,
      hash: '',
      selected: false,
    }));
    set({ archiveFiles: [...current, ...newFiles], isArchiveModified: true });
  },

  removeSelectedFiles: () => {
    const files = get().archiveFiles.filter(f => !f.selected);
    set({ archiveFiles: files, isArchiveModified: true });
  },

  toggleFileSelection: (name) => {
    const files = get().archiveFiles.map(f =>
      f.name === name ? { ...f, selected: !f.selected } : f
    );
    set({ archiveFiles: files });
  },

  selectAllFiles: () => {
    set({ archiveFiles: get().archiveFiles.map(f => ({ ...f, selected: true })) });
  },

  deselectAllFiles: () => {
    set({ archiveFiles: get().archiveFiles.map(f => ({ ...f, selected: false })) });
  },

  setArchiveModified: (isArchiveModified) => set({ isArchiveModified }),
  setArchiveRawData: (archiveRawData) => set({ archiveRawData }),

  // 검증
  verificationResults: [],
  setVerificationResults: (verificationResults) => set({ verificationResults }),

  // UI
  detailSheetOpen: false,
  setDetailSheetOpen: (detailSheetOpen) => set({ detailSheetOpen }),

  activeDialog: null,
  setActiveDialog: (activeDialog) => set({ activeDialog }),
}));

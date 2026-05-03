/**
 * 탐색기 마지막 디렉토리 기억 — IndexedDB.
 *
 * - File System Access API (Chrome/Edge): FileSystemDirectoryHandle 까지 저장 →
 *   다음 방문 시 queryPermission/requestPermission 으로 같은 폴더 재스캔 가능
 * - webkitdirectory 폴백 (iOS/Firefox): handle 저장 불가 → 메타데이터만 캐시,
 *   사용자가 다시 선택해야 갱신
 *
 * 본문 파일 자체는 저장하지 않음 (zero-knowledge 원칙).
 * 헤더 메타 (PKI 봉투) + 파일 메타 (이름/경로/크기/타입) 만 보관.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PkiHeader } from '@/lib/container/pki-format';

export interface CachedEntry {
  id: string;
  name: string;
  relPath: string;
  size: number;
  addedAt: number;
  kind: 'pki' | 'other';
  mime?: string;
  header: PkiHeader | null;
}

export type AccessMode = 'fs-access' | 'webkit';

export interface LastFolder {
  rootName: string;
  entries: CachedEntry[];
  /** File System Access API 핸들 — fs-access 모드에서만 */
  dirHandle?: FileSystemDirectoryHandle;
  /** 마지막 스캔 시각 */
  scannedAt: number;
  accessMode: AccessMode;
}

interface ExplorerDBSchema extends DBSchema {
  'last-folder': {
    key: string;
    value: LastFolder & { key: string };
  };
}

const DB_NAME = 'pkizip-explorer';
const DB_VERSION = 1;
const KEY = 'last';

let _db: Promise<IDBPDatabase<ExplorerDBSchema>> | null = null;

function db(): Promise<IDBPDatabase<ExplorerDBSchema>> {
  if (!_db) {
    _db = openDB<ExplorerDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('last-folder', { keyPath: 'key' });
      },
    });
  }
  return _db;
}

export async function saveLastFolder(data: LastFolder): Promise<void> {
  try {
    const d = await db();
    await d.put('last-folder', { key: KEY, ...data });
  } catch (e) {
    // 일부 브라우저는 FileSystemDirectoryHandle 의 structured clone 을 거부할 수 있음
    // → 핸들 빼고 메타만 재시도
    if (data.dirHandle) {
      console.warn('[last-folder] 핸들 저장 실패, 메타만 보관:', e);
      const d = await db();
      await d.put('last-folder', { key: KEY, ...data, dirHandle: undefined });
    } else {
      throw e;
    }
  }
}

export async function loadLastFolder(): Promise<LastFolder | null> {
  try {
    const d = await db();
    const rec = await d.get('last-folder', KEY);
    if (!rec) return null;
    const { key, ...rest } = rec;
    void key;
    return rest as LastFolder;
  } catch (e) {
    console.warn('[last-folder] 로드 실패:', e);
    return null;
  }
}

export async function clearLastFolder(): Promise<void> {
  const d = await db();
  await d.delete('last-folder', KEY);
}

/**
 * 디렉토리 핸들의 읽기 권한 확인 — granted 면 즉시 사용 가능,
 * prompt 면 사용자 제스처 (버튼 클릭 등) 안에서 requestPermission 필요.
 */
export async function checkHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<'granted' | 'prompt' | 'denied'> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      queryPermission?: (opts: { mode: string }) => Promise<'granted' | 'prompt' | 'denied'>;
    };
    if (typeof h.queryPermission === 'function') {
      return await h.queryPermission({ mode: 'read' });
    }
    return 'prompt';
  } catch {
    return 'denied';
  }
}

export async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<'granted' | 'denied'> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      requestPermission?: (opts: { mode: string }) => Promise<'granted' | 'denied'>;
    };
    if (typeof h.requestPermission === 'function') {
      return await h.requestPermission({ mode: 'read' });
    }
    return 'denied';
  } catch {
    return 'denied';
  }
}

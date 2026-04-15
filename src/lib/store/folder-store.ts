/**
 * Folder Store - 출력 폴더 관리
 *
 * PWA에서 File System Access API를 사용하여 출력 폴더를 관리한다.
 * 지원하지 않는 브라우저에서는 다운로드 폴더 대체.
 */

const FOLDER_HANDLE_KEY = 'pkizip-output-folder';

/**
 * File System Access API 지원 여부
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * 출력 폴더 선택 (File System Access API)
 */
export async function selectOutputFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;

  try {
    const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    // IndexedDB에 핸들 저장
    await saveHandleToIDB(handle);
    return handle;
  } catch {
    return null; // 사용자 취소
  }
}

/**
 * 저장된 출력 폴더 핸들 가져오기
 */
export async function getOutputFolder(): Promise<FileSystemDirectoryHandle | null> {
  return loadHandleFromIDB();
}

/**
 * 출력 폴더에 파일 저장
 */
export async function saveFileToFolder(
  handle: FileSystemDirectoryHandle,
  filename: string,
  data: Uint8Array
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data.slice());
  await writable.close();
}

/**
 * 출력 폴더에서 .pki 파일 목록 읽기
 */
export async function listPkiFiles(
  handle: FileSystemDirectoryHandle
): Promise<{ name: string; file: File }[]> {
  const results: { name: string; file: File }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (handle as any).values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.pki')) {
      const file = await entry.getFile();
      results.push({ name: entry.name, file });
    }
  }

  // 최신 파일이 위로
  results.sort((a, b) => b.file.lastModified - a.file.lastModified);
  return results;
}

// === IndexedDB 핸들 저장 ===

async function saveHandleToIDB(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFolderDB();
  const tx = db.transaction('handles', 'readwrite');
  tx.objectStore('handles').put({ key: FOLDER_HANDLE_KEY, handle });
  await new Promise(r => { tx.oncomplete = r; });
  db.close();
}

async function loadHandleFromIDB(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openFolderDB();
    const tx = db.transaction('handles', 'readonly');
    const result = await new Promise<{ key: string; handle: FileSystemDirectoryHandle } | undefined>((resolve) => {
      const req = tx.objectStore('handles').get(FOLDER_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    db.close();

    if (!result?.handle) return null;

    // 권한 확인/요청 (File System Access API 확장)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = result.handle as any;
    if (h.queryPermission) {
      const perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return result.handle;
      const req = await h.requestPermission({ mode: 'readwrite' });
      return req === 'granted' ? result.handle : null;
    }
    return result.handle;
  } catch {
    return null;
  }
}

function openFolderDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pkizip-folders', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('handles', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

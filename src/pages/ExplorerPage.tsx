/**
 * 파일 탐색기 — PKIZIP 으로 만든 봉투(.pki/.pkizip)만 표시.
 *
 * 사용자 명세 (7):
 *   - 작은 카드 형태, 화면 전체 사용
 *   - 등급(C/S/O) + 암호화 여부에 따라 다른 아이콘
 *   - 복호화 없이 정보 보기 (META 헤더만 파싱)
 *   - 나중에 분리 가능 — 별도 파일 탐색기 컴포넌트로 추출
 *
 * 데이터 소스:
 *   - 사용자가 드래그앤드롭 / 파일선택으로 봉투 추가
 *   - localStorage(IndexedDB) 에 메타 캐시
 *   - 옵션: Supabase 에서 본인 봉투 메타 fetch
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Upload, FileLock2, FileCheck2, Search, X, FileText, ShieldCheck,
  FolderOpen, File as FileIcon, Folder, RefreshCw, Trash2,
} from 'lucide-react';
import { isPkiFile, readPkiHeader, deriveBadge, type PkiHeader } from '@/lib/container/pki-format';
import { prefs, type ExplorerPrefs } from '@/lib/store/preferences';
import {
  saveLastFolder, loadLastFolder, clearLastFolder,
  checkHandlePermission, requestHandlePermission,
  type AccessMode,
} from '@/lib/store/last-folder';

interface ExplorerEntry {
  id: string;                 // uuid
  name: string;
  /** 디렉토리 기준 상대 경로 (디렉토리 walk 의 경우) — 없으면 파일명과 동일 */
  relPath: string;
  size: number;
  addedAt: number;
  /** PKI 봉투 = 헤더 파싱됨 / other = 그 외 일반 파일 */
  kind: 'pki' | 'other';
  /** 일반 파일의 MIME (있으면) */
  mime?: string;
  header: PkiHeader | null;
  // 본문(Uint8Array) 은 IndexedDB. 여기선 헤더만.
}

interface WalkedFile { path: string; file: File }

/** File System Access API — 재귀 walk */
async function walkDirHandle(
  handle: FileSystemDirectoryHandle, base = '',
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  // @ts-expect-error - entries() is on async iterator
  for await (const [name, entry] of handle.entries()) {
    const path = base ? `${base}/${name}` : name;
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.push({ path, file });
    } else if (entry.kind === 'directory') {
      const nested = await walkDirHandle(entry as FileSystemDirectoryHandle, path);
      out.push(...nested);
    }
  }
  return out;
}

/** webkitdirectory fallback — File.webkitRelativePath 사용 */
function walkFromInput(files: FileList): WalkedFile[] {
  return Array.from(files).map(file => ({
    // Chrome/Edge: webkitRelativePath = "RootDir/sub/file.ext"
    // 첫 디렉토리명을 떼고 base 기준 상대 경로로
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath
            ?.split('/').slice(1).join('/') || file.name,
    file,
  }));
}

const PKI_EXTS = ['.pki', '.pkizip', '.pqcz'];
function isPkiByName(name: string): boolean {
  const lower = name.toLowerCase();
  return PKI_EXTS.some(ext => lower.endsWith(ext));
}

export function ExplorerPage() {
  const [entries, setEntries] = useState<ExplorerEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [explorerPrefs, setExplorerPrefs] = useState<ExplorerPrefs>(() => prefs.explorer.get());
  const [selected, setSelected] = useState<ExplorerEntry | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanRoot, setScanRoot] = useState<string | null>(null);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  // ─── 마운트 시 마지막 디렉토리 캐시 복원 ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadLastFolder();
      if (cancelled || !cached) return;
      setEntries(cached.entries);
      setScanRoot(cached.rootName);
      setLastScanAt(cached.scannedAt);
      setAccessMode(cached.accessMode);
      if (cached.dirHandle) setSavedHandle(cached.dirHandle);
    })();
    return () => { cancelled = true; };
  }, []);

  // 디렉토리 walk 결과를 저장 — 재방문 시 복원용
  const persistFolder = useCallback(async (
    rootName: string,
    entriesList: ExplorerEntry[],
    handle: FileSystemDirectoryHandle | undefined,
    mode: AccessMode,
  ) => {
    const scannedAt = Date.now();
    setLastScanAt(scannedAt);
    setAccessMode(mode);
    if (handle) setSavedHandle(handle);
    try {
      await saveLastFolder({
        rootName,
        entries: entriesList.map(e => ({
          id: e.id, name: e.name, relPath: e.relPath, size: e.size,
          addedAt: e.addedAt, kind: e.kind, mime: e.mime, header: e.header,
        })),
        dirHandle: handle,
        scannedAt,
        accessMode: mode,
      });
    } catch (err) {
      console.warn('[explorer] 캐시 저장 실패:', err);
    }
  }, []);

  // walked 파일 리스트 → ExplorerEntry[] 변환 (PKI 헤더 파싱 포함)
  const buildEntries = useCallback(async (walked: WalkedFile[]): Promise<ExplorerEntry[]> => {
    const out: ExplorerEntry[] = [];
    for (const { path, file } of walked) {
      let header: PkiHeader | null = null;
      let kind: 'pki' | 'other' = 'other';
      if (isPkiByName(file.name)) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (isPkiFile(buf)) {
            header = readPkiHeader(buf);
            kind = 'pki';
          }
        } catch (e) {
          console.warn(`PKI 파싱 실패 (${path}):`, e);
        }
      }
      out.push({
        id: crypto.randomUUID(),
        name: file.name,
        relPath: path,
        size: file.size,
        addedAt: Date.now(),
        kind,
        mime: file.type || undefined,
        header,
      });
    }
    return out;
  }, []);

  // "파일 추가" — 기존 엔트리 앞에 prepend
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const additions = await buildEntries(list.map(f => ({ path: f.name, file: f })));
    setEntries(prev => [...additions, ...prev]);
  }, [buildEntries]);

  // "디렉토리 선택" — 기존 엔트리 전체 교체 + 캐시 저장
  const ingestDirectory = useCallback(async (
    rootName: string,
    walked: WalkedFile[],
    handle: FileSystemDirectoryHandle | undefined,
    mode: AccessMode,
  ) => {
    const built = await buildEntries(walked);
    setEntries(built);
    setScanRoot(rootName);
    await persistFolder(rootName, built, handle, mode);
  }, [buildEntries, persistFolder]);

  // 디렉토리 선택 — File System Access API 우선, webkitdirectory 폴백.
  // 다운로드/바탕화면/문서 등 well-known 시스템 폴더는 Chrome 이 직접 차단하므로
  // AbortError / SecurityError 발생 시 사용자에게 호환 모드 제안.
  const pickDirectoryViaInput = useCallback(() => {
    dirInputRef.current?.click();
  }, []);

  const pickDirectory = useCallback(async () => {
    const w = window as typeof window & {
      showDirectoryPicker?: (opts?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof w.showDirectoryPicker !== 'function') {
      pickDirectoryViaInput();
      return;
    }
    try {
      setScanning(true);
      const handle = await w.showDirectoryPicker({ id: 'pkizip-explorer', mode: 'read' });
      const walked = await walkDirHandle(handle);
      await ingestDirectory(handle.name, walked, handle, 'fs-access');
    } catch (e) {
      const err = e as Error;
      const blocked = err.name === 'SecurityError'
        || /system files|시스템 파일|well[- ]known/i.test(err.message);
      const aborted = err.name === 'AbortError';
      if (blocked || aborted) {
        // 시스템 폴더 차단 또는 사용자 취소 — 호환 모드 자동 제안
        const useFallback = confirm(
          (blocked
            ? 'Chrome 이 이 폴더를 차단했습니다 (다운로드/바탕화면/문서 등 시스템 폴더는 직접 열 수 없음).\n\n'
            : '폴더 선택이 취소되었습니다.\n\n') +
          '호환 모드(webkitdirectory) 로 재시도할까요? 시스템 폴더도 모두 열 수 있습니다.'
        );
        if (useFallback) {
          pickDirectoryViaInput();
        }
      } else {
        console.error('디렉토리 walk 실패:', err);
        alert('디렉토리 읽기 실패: ' + String(err));
      }
    } finally {
      setScanning(false);
    }
  }, [ingestDirectory, pickDirectoryViaInput]);

  const onDirInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setScanning(true);
    const first = files[0] as File & { webkitRelativePath?: string };
    const root = first.webkitRelativePath?.split('/')[0] ?? '선택한 폴더';
    try {
      await ingestDirectory(root, walkFromInput(files), undefined, 'webkit');
    } finally {
      setScanning(false);
      e.target.value = '';
    }
  }, [ingestDirectory]);

  // ─── 캐시된 핸들로 자동 재스캔 (FS Access API 만 가능) ───────────
  const refreshFromHandle = useCallback(async () => {
    if (!savedHandle) return;
    setScanning(true);
    try {
      const perm = await checkHandlePermission(savedHandle);
      if (perm !== 'granted') {
        const req = await requestHandlePermission(savedHandle);
        if (req !== 'granted') {
          alert('읽기 권한이 거부되었습니다. 디렉토리를 다시 선택해주세요.');
          return;
        }
      }
      const walked = await walkDirHandle(savedHandle);
      await ingestDirectory(savedHandle.name, walked, savedHandle, 'fs-access');
    } catch (e) {
      console.error('재스캔 실패:', e);
      alert('재스캔 실패: ' + String(e));
    } finally {
      setScanning(false);
    }
  }, [savedHandle, ingestDirectory]);

  const clearCache = useCallback(async () => {
    if (!confirm('마지막 디렉토리 기억을 삭제하시겠습니까?')) return;
    await clearLastFolder();
    setEntries([]);
    setScanRoot(null);
    setSavedHandle(null);
    setLastScanAt(null);
    setAccessMode(null);
  }, []);

  // 드래그앤드롭
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // 필터 + 정렬
  const visible = useMemo(() => {
    let xs = entries;
    if (filter) {
      const f = filter.toLowerCase();
      xs = xs.filter(e =>
        e.name.toLowerCase().includes(f) ||
        e.relPath.toLowerCase().includes(f) ||
        e.header?.classification?.grade?.toLowerCase().includes(f)
      );
    }
    if (explorerPrefs.filterGrade && explorerPrefs.filterGrade !== 'all') {
      xs = xs.filter(e =>
        e.kind === 'pki' && e.header?.classification?.grade === explorerPrefs.filterGrade);
    }
    const sortBy = explorerPrefs.sortBy;
    const dir = explorerPrefs.sortDir === 'asc' ? 1 : -1;
    xs = [...xs].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      else if (sortBy === 'grade') {
        const order = { C: 0, S: 1, O: 2, unknown: 3 };
        cmp = (order[a.header?.classification?.grade ?? 'unknown' as 'C'|'S'|'O'|'unknown'] ?? 3)
            - (order[b.header?.classification?.grade ?? 'unknown' as 'C'|'S'|'O'|'unknown'] ?? 3);
      } else cmp = a.addedAt - b.addedAt;
      return cmp * dir;
    });
    return xs;
  }, [entries, filter, explorerPrefs]);

  function setPref<K extends keyof ExplorerPrefs>(k: K, v: ExplorerPrefs[K]) {
    const next = prefs.explorer.set({ [k]: v } as Partial<ExplorerPrefs>);
    setExplorerPrefs(next);
  }

  return (
    <div className="min-h-screen flex flex-col" onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {/* 헤더 */}
      <div className="border-b bg-white sticky top-0 z-10 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-600" />
            <div>
              <h1 className="font-semibold text-lg">내 PKIZIP 파일</h1>
              <p className="text-xs text-zinc-500">
                복호화 없이 등급·암호화·언어·OCR 등 메타데이터를 즉시 확인
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="파일명·등급 검색..."
                className="pl-7 pr-2 py-1.5 border rounded text-sm w-56"
              />
            </div>
            <select value={explorerPrefs.filterGrade || 'all'}
              onChange={e => setPref('filterGrade', e.target.value as ExplorerPrefs['filterGrade'])}
              className="px-2 py-1.5 border rounded text-sm">
              <option value="all">모든 등급</option>
              <option value="C">C 위험</option>
              <option value="S">S 민감</option>
              <option value="O">O 공개</option>
            </select>
            <select value={explorerPrefs.sortBy}
              onChange={e => setPref('sortBy', e.target.value as ExplorerPrefs['sortBy'])}
              className="px-2 py-1.5 border rounded text-sm">
              <option value="date">날짜</option>
              <option value="name">이름</option>
              <option value="grade">등급</option>
              <option value="size">크기</option>
            </select>
            <div className="inline-flex rounded overflow-hidden border border-emerald-700">
              <button onClick={pickDirectory} disabled={scanning}
                className="px-3 py-1.5 bg-emerald-600 text-white text-sm flex items-center gap-1.5 hover:bg-emerald-700 disabled:bg-zinc-300">
                <FolderOpen className="w-4 h-4" />
                {scanning ? '스캔 중…' : '디렉토리 선택'}
              </button>
              <button onClick={pickDirectoryViaInput} disabled={scanning}
                title="다운로드 등 시스템 폴더 포함 모든 폴더 (webkitdirectory)"
                className="px-2 py-1.5 bg-emerald-700 text-white text-[11px] hover:bg-emerald-800 disabled:bg-zinc-300 border-l border-emerald-800">
                호환
              </button>
            </div>
            <button onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700">
              <Upload className="w-4 h-4" /> 파일 추가
            </button>
            <input
              ref={inputRef}
              type="file" multiple accept=".pki,.pkizip"
              className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)}
            />
            <input
              ref={dirInputRef}
              type="file"
              // @ts-expect-error - webkitdirectory 는 비표준 속성
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={onDirInput}
            />
          </div>
        </div>
        {(scanRoot || scanning) ? (
          <div className="mt-2 text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap">
            <Folder className="w-3 h-3 flex-shrink-0" />
            {scanning ? (
              <span className="text-emerald-600">디렉토리 스캔 중… (파일 시스템 walk)</span>
            ) : (
              <>
                <span>
                  기준 디렉토리: <code className="font-mono text-zinc-700">{scanRoot}</code>
                  · {entries.length}개 파일 ({entries.filter(e => e.kind === 'pki').length} PKI · {entries.filter(e => e.kind === 'other').length} 기타)
                </span>
                {lastScanAt && (
                  <span className="text-zinc-400">· 마지막 스캔 {new Date(lastScanAt).toLocaleString()}</span>
                )}
                {savedHandle && (
                  <button
                    onClick={refreshFromHandle}
                    title="저장된 핸들로 재스캔 (권한 재요청 가능)"
                    className="ml-1 inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-1.5 py-0.5 rounded"
                  >
                    <RefreshCw className="w-3 h-3" /> 재스캔
                  </button>
                )}
                {accessMode === 'webkit' && !savedHandle && (
                  <span className="text-amber-600 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200">
                    💾 메타 캐시 (재스캔하려면 디렉토리 다시 선택)
                  </span>
                )}
                <button
                  onClick={clearCache}
                  title="마지막 디렉토리 기억 삭제"
                  className="ml-auto inline-flex items-center gap-1 text-red-600 hover:text-red-800 hover:bg-red-50 px-1.5 py-0.5 rounded"
                >
                  <Trash2 className="w-3 h-3" /> 비우기
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-zinc-400">
            💡 Chrome 은 다운로드 / 바탕화면 / 문서 폴더를 직접 차단합니다 — 차단되면
            <b className="text-emerald-700"> 호환</b> 버튼 또는 자동 폴백을 사용하세요.
            마지막에 본 폴더는 자동 기억됩니다.
          </div>
        )}
      </div>

      {/* 본문 — 카드 그리드 */}
      <div className={`flex-1 p-6 ${dragging ? 'bg-blue-50' : ''}`}>
        {entries.length === 0 ? (
          <EmptyState
            onPickFile={() => inputRef.current?.click()}
            onPickDir={pickDirectory}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {visible.map(e => (
              <FileCard key={e.id} entry={e} onClick={() => setSelected(e)} />
            ))}
          </div>
        )}
      </div>

      {/* 상세 패널 */}
      {selected && (
        <DetailPanel entry={selected} onClose={() => setSelected(null)} />
      )}

      {/* 드래그 오버레이 */}
      {dragging && (
        <div className="fixed inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400 pointer-events-none flex items-center justify-center z-50">
          <div className="text-2xl font-bold text-blue-700">📥 .pki / .pkizip 파일을 놓으세요</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 카드 — 등급 아이콘 + 메타
// ─────────────────────────────────────────────

function FileCard({ entry, onClick }: { entry: ExplorerEntry; onClick: () => void }) {
  const badge = deriveBadge(entry.header);
  const colors = gradeColors(badge.grade);
  const isPki = entry.kind === 'pki';
  const otherColors = {
    border: 'border-zinc-200', icon: 'text-zinc-500', iconBg: 'bg-zinc-50',
    pill: 'bg-zinc-100 text-zinc-600',
  };
  const palette = isPki ? colors : otherColors;
  // 상대 경로의 디렉토리 부분만 — "sub/dir/file.txt" → "sub/dir"
  const dirPart = entry.relPath.includes('/')
    ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/'))
    : '';

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      className={`text-left bg-white border rounded-xl p-4 hover:shadow-md transition ${palette.border} ${
        !isPki ? 'opacity-90' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${palette.iconBg}`}>
          {!isPki ? (
            <FileIcon className={`w-5 h-5 ${palette.icon}`} />
          ) : badge.encrypted ? (
            <FileLock2 className={`w-5 h-5 ${palette.icon}`} />
          ) : badge.signed ? (
            <FileCheck2 className={`w-5 h-5 ${palette.icon}`} />
          ) : (
            <FileText className={`w-5 h-5 ${palette.icon}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" title={entry.relPath}>{entry.name}</div>
          {dirPart && (
            <div className="text-[10px] text-zinc-400 truncate font-mono" title={entry.relPath}>
              📁 {dirPart}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {isPki ? (
              <>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${palette.pill}`}>
                  {badge.grade.toUpperCase()}
                </span>
                {badge.pqc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">PQC</span>}
                {badge.he && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700">🔍 HE</span>}
                {badge.signed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">✍</span>}
              </>
            ) : (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${palette.pill}`}>
                {fileExtLabel(entry.name, entry.mime)}
              </span>
            )}
          </div>
        </div>
      </div>
      {isPki && entry.header?.classification?.findingsSummary && (
        <div className="mt-2 text-[10px] text-zinc-500 line-clamp-1">
          {Object.entries(entry.header.classification.findingsSummary).slice(0, 3)
            .map(([k, v]) => `${k}×${v}`).join(' · ')}
        </div>
      )}
      <div className="mt-2 text-[10px] text-zinc-400">
        {formatSize(entry.size)}
        {isPki && entry.header?.language?.detected && entry.header.language.detected !== 'und' && (
          <> · {entry.header.language.detected}</>
        )}
        {isPki && entry.header?.ocr?.applied && <> · OCR</>}
      </div>
    </motion.button>
  );
}

function fileExtLabel(name: string, mime?: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m) return m[1]!.toUpperCase();
  if (mime) return mime.split('/').pop() || 'FILE';
  return 'FILE';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─────────────────────────────────────────────
// 상세 패널 — 메타 전체 (복호화 X)
// ─────────────────────────────────────────────

function DetailPanel({ entry, onClose }: { entry: ExplorerEntry; onClose: () => void }) {
  const h = entry.header;
  const c = h?.classification;
  const badge = deriveBadge(h);
  const isPki = entry.kind === 'pki';
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <motion.div
        initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        onClick={e => e.stopPropagation()}
        className="relative w-[420px] bg-white shadow-2xl h-full overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-sm truncate" title={entry.relPath}>{entry.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <Row label="경로">
            <code className="text-xs font-mono break-all text-zinc-600">{entry.relPath}</code>
          </Row>
          {!isPki && (
            <>
              <Row label="유형">
                <span className="text-xs px-2 py-0.5 bg-zinc-100 rounded">{fileExtLabel(entry.name, entry.mime)}</span>
                {entry.mime && <span className="text-[11px] text-zinc-500 ml-2 font-mono">{entry.mime}</span>}
              </Row>
              <Row label="크기">{formatSize(entry.size)}</Row>
              <Row label="추가일시">{new Date(entry.addedAt).toLocaleString()}</Row>
              <div className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded p-3 leading-relaxed">
                일반 파일 — PKIZIP 봉투가 아니라서 등급/암호화 정보가 없습니다.
                필요하면 "봉투 만들기" 페이지에서 분석·가명화·암호화 후 .pki 봉투로 변환하세요.
              </div>
            </>
          )}
          {isPki && (
            <>
              <Row label="등급">
                <span className={`inline-block px-2 py-0.5 rounded font-bold ${gradeColors(badge.grade).pill}`}>
                  {badge.grade.toUpperCase()}
                </span>
                {c && <span className="text-xs text-zinc-500 ml-2">신뢰도 {(c.confidence * 100).toFixed(0)}%</span>}
              </Row>
              <Row label="암호화">
                {badge.encrypted ? (
                  <>🔒 {h?.pqcKemRecipientInfo ? <b className="text-violet-700">PQC</b> : '단순'}
                    {h?.encryption?.algorithm && <span className="text-xs text-zinc-500 ml-2">{h.encryption.algorithm}</span>}
                  </>
                ) : '없음 (서명만)'}
              </Row>
              <Row label="서명">
                {badge.signed ? <ShieldCheck className="inline w-4 h-4 text-emerald-600 mr-1" /> : '—'}
                {h?.pqcSignerInfo?.algorithm && <b>{h.pqcSignerInfo.algorithm}</b>}
                {h?.signatures && h.signatures.length > 0 && <> · {h.signatures.length}개 서명</>}
              </Row>
              {c && (
                <Row label="분류기 버전">
                  <code className="text-xs">{c.classifierVersion}</code>
                </Row>
              )}
              {h?.language?.detected && (
                <Row label="언어">
                  {h.language.detected.toUpperCase()}
                  <span className="text-xs text-zinc-500 ml-2">{(h.language.confidence * 100).toFixed(0)}%</span>
                </Row>
              )}
              {h?.ocr?.applied && (
                <Row label="OCR">
                  {h.ocr.engine} · {h.ocr.languages?.join(', ')}
                  {h.ocr.confidence && <span className="text-xs text-zinc-500 ml-2">{(h.ocr.confidence * 100).toFixed(0)}%</span>}
                </Row>
              )}
              {h?.searchKey?.included && (
                <Row label="HE 검색키">
                  <code className="text-xs">{h.searchKey.engine} · {h.searchKey.scheme}</code>
                  {h.searchKey.tokenCount && <span className="text-xs text-zinc-500 ml-2">{h.searchKey.tokenCount} tokens</span>}
                </Row>
              )}
              {c?.findingsSummary && Object.keys(c.findingsSummary).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase mb-2">탐지된 PII</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(c.findingsSummary).map(([k, v]) => (
                      <span key={k} className="text-xs px-2 py-0.5 bg-zinc-100 rounded font-mono">
                        {k} <b>×{v}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {c?.explanation && (
                <div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase mb-2">설명</div>
                  <p className="text-xs leading-relaxed text-zinc-700">{c.explanation}</p>
                </div>
              )}
              {h?.pseudonymization?.applied && (
                <Row label="가명/익명화">
                  {h.pseudonymization.isReversible ? '가명 (복원 가능)' : '익명 (비가역)'}
                  {h.pseudonymization.targetGrade && <> · target {h.pseudonymization.targetGrade}</>}
                </Row>
              )}
              {h?.mipLabel && (
                <div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase mb-2">MIP 라벨</div>
                  <code className="text-xs block bg-zinc-50 p-2 rounded">
                    {h.mipLabel.labelName} (sensitivity={h.mipLabel.sensitivityValue})
                  </code>
                </div>
              )}
              <Row label="추가일시">{new Date(entry.addedAt).toLocaleString()}</Row>
              <Row label="크기">{formatSize(entry.size)}</Row>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-zinc-500 w-20 flex-shrink-0">{label}</span>
      <span className="text-sm flex-1">{children}</span>
    </div>
  );
}

function EmptyState({ onPickFile, onPickDir }: { onPickFile: () => void; onPickDir: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
        <FolderOpen className="w-7 h-7 text-zinc-400" />
      </div>
      <p className="text-sm text-zinc-500 mb-1">아직 파일이 없습니다</p>
      <p className="text-xs text-zinc-400 mb-4">디렉토리 선택 → 하위 모든 파일 / 또는 .pki 파일 드래그·추가</p>
      <div className="flex gap-2">
        <button onClick={onPickDir} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm flex items-center gap-1.5">
          <FolderOpen className="w-4 h-4" /> 디렉토리 선택
        </button>
        <button onClick={onPickFile} className="px-4 py-2 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5">
          <Upload className="w-4 h-4" /> 파일 선택
        </button>
      </div>
      <p className="text-[10px] text-zinc-400 mt-3 max-w-md">
        디렉토리 선택은 File System Access API (Chrome/Edge) 또는 webkitdirectory 폴백으로
        하위 모든 파일을 재귀적으로 스캔합니다. 본문은 외부 전송 없음.
      </p>
    </div>
  );
}

function gradeColors(grade: 'C' | 'S' | 'O' | 'unknown') {
  switch (grade) {
    case 'C': return {
      border: 'border-red-200', icon: 'text-red-600', iconBg: 'bg-red-50',
      pill: 'bg-red-100 text-red-700',
    };
    case 'S': return {
      border: 'border-amber-200', icon: 'text-amber-600', iconBg: 'bg-amber-50',
      pill: 'bg-amber-100 text-amber-700',
    };
    case 'O': return {
      border: 'border-emerald-200', icon: 'text-emerald-600', iconBg: 'bg-emerald-50',
      pill: 'bg-emerald-100 text-emerald-700',
    };
    default: return {
      border: 'border-zinc-200', icon: 'text-zinc-400', iconBg: 'bg-zinc-50',
      pill: 'bg-zinc-100 text-zinc-500',
    };
  }
}

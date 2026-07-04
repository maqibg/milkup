import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

export function normalizeWatchPath(inputPath: string): string {
  if (!inputPath) return inputPath;
  if (/^\\\\\?\\UNC\\/i.test(inputPath)) return "\\\\" + inputPath.slice(8);
  if (/^\\\\\?\\[a-zA-Z]:\\/.test(inputPath)) return inputPath.slice(4);
  return inputPath;
}

export type WatchKind = "wsl" | "chokidar";

export function classifyWatchTarget(inputPath: string): WatchKind {
  const normalizedPath = normalizeWatchPath(inputPath || "");
  return /^\\\\wsl(?:\$|\.localhost)\\/i.test(normalizedPath) ? "wsl" : "chokidar";
}

export function partitionPaths(paths: string[]): { wsl: string[]; chokidar: string[] } {
  const wsl: string[] = [];
  const chokidar: string[] = [];

  for (const filePath of paths) {
    if (classifyWatchTarget(filePath) === "wsl") wsl.push(filePath);
    else chokidar.push(filePath);
  }

  return { wsl, chokidar };
}

export function snapshotEntry(mtimeMs: number, size: number): string {
  return `${Math.trunc(mtimeMs)}:${size}`;
}

export function snapshotChanged(prev: Map<string, string>, curr: Map<string, string>): boolean {
  if (prev.size !== curr.size) return true;
  for (const [key, value] of curr) {
    if (prev.get(key) !== value) return true;
  }
  return false;
}

export const MAX_DEPTH = 10;
export const MAX_FILES_PER_DIR = 100;

const IGNORE_PATTERNS = [
  /^\.git$/,
  /^\.vscode$/,
  /^\.idea$/,
  /^node_modules$/,
  /^\.next$/,
  /^\.nuxt$/,
  /^dist$/,
  /^build$/,
  /^coverage$/,
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
];

export function shouldIgnoreDirectory(name: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isSupportedWorkspaceFile(name: string): boolean {
  return /\.(?:md|markdown|png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
}

export interface WorkspaceNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  mtime: number;
  children?: WorkspaceNode[];
}

async function getMtimeMsSafe(targetPath: string): Promise<number> {
  try {
    return (await fsp.stat(targetPath)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function scanDirectory(
  dirPath: string,
  opts: { isWslRemote: boolean },
  depth = 0
): Promise<WorkspaceNode[]> {
  if (depth > MAX_DEPTH) return [];

  let items: fs.Dirent[];
  try {
    items = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  if (items.length > MAX_FILES_PER_DIR) items.splice(MAX_FILES_PER_DIR);

  const directories: WorkspaceNode[] = [];
  const files: WorkspaceNode[] = [];

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    if (item.isSymbolicLink()) {
      if (opts.isWslRemote) continue;
      if (!isSupportedWorkspaceFile(item.name)) continue;
      const mtime = await getMtimeMsSafe(itemPath);
      files.push({ name: item.name, path: itemPath, isDirectory: false, isSymlink: true, mtime });
      continue;
    }

    if (item.isDirectory()) {
      if (shouldIgnoreDirectory(item.name)) continue;
      const children = await scanDirectory(itemPath, opts, depth + 1);
      const mtime = await getMtimeMsSafe(itemPath);
      directories.push({ name: item.name, path: itemPath, isDirectory: true, mtime, children });
    } else if (item.isFile() && isSupportedWorkspaceFile(item.name)) {
      const mtime = await getMtimeMsSafe(itemPath);
      files.push({ name: item.name, path: itemPath, isDirectory: false, mtime });
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...directories, ...files];
}

export async function snapshotDirectory(dirPath: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let items: fs.Dirent[];
    try {
      items = await fsp.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    if (items.length > MAX_FILES_PER_DIR) items.splice(MAX_FILES_PER_DIR);

    for (const item of items) {
      if (item.isSymbolicLink()) continue;

      const itemPath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        if (shouldIgnoreDirectory(item.name)) continue;
        try {
          const stat = await fsp.stat(itemPath);
          snapshot.set(itemPath, snapshotEntry(stat.mtimeMs, stat.size));
        } catch {
          // Ignore transient filesystem entries.
        }
        await walk(itemPath, depth + 1);
      } else if (item.isFile() && isSupportedWorkspaceFile(item.name)) {
        try {
          const stat = await fsp.stat(itemPath);
          snapshot.set(itemPath, snapshotEntry(stat.mtimeMs, stat.size));
        } catch {
          // Ignore transient filesystem entries.
        }
      }
    }
  }

  await walk(dirPath, 0);
  return snapshot;
}

export interface WslDirWatcherOptions {
  intervalMs?: number;
  debounceMs?: number;
  snapshot?: (dirPath: string) => Promise<Map<string, string>>;
  exists?: (dirPath: string) => boolean | Promise<boolean>;
  onChanged: () => void;
}

interface DirState {
  timer: ReturnType<typeof setInterval> | null;
  epoch: number;
  inFlight: boolean;
  snapshot: Map<string, string> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class WslDirectoryWatcher {
  private dirs = new Map<string, DirState>();
  private intervalMs: number;
  private debounceMs: number;
  private snapshotFn: (dirPath: string) => Promise<Map<string, string>>;
  private existsFn: (dirPath: string) => boolean | Promise<boolean>;
  private onChanged: () => void;

  constructor(opts: WslDirWatcherOptions) {
    this.intervalMs = opts.intervalMs ?? 4000;
    this.debounceMs = opts.debounceMs ?? 300;
    this.snapshotFn = opts.snapshot ?? snapshotDirectory;
    this.existsFn =
      opts.exists ??
      (async (targetPath: string) => {
        try {
          await fsp.access(targetPath);
          return true;
        } catch {
          return false;
        }
      });
    this.onChanged = opts.onChanged;
  }

  watch(dirPath: string): void {
    this.unwatch(dirPath);
    const state: DirState = {
      timer: null,
      epoch: 0,
      inFlight: false,
      snapshot: null,
      debounceTimer: null,
    };
    this.dirs.set(dirPath, state);
    state.timer = setInterval(() => void this.tick(dirPath), this.intervalMs);
    void this.tick(dirPath, true);
  }

  private async tick(dirPath: string, baseline = false): Promise<void> {
    const state = this.dirs.get(dirPath);
    if (!state || state.inFlight) return;

    state.inFlight = true;
    const epoch = state.epoch;

    try {
      const reachable = await this.existsFn(dirPath);
      let curr: Map<string, string>;
      try {
        curr = await this.snapshotFn(dirPath);
      } catch {
        return;
      }

      if (this.dirs.get(dirPath) !== state || epoch !== state.epoch) return;
      if (!reachable && state.snapshot && state.snapshot.size > 0 && curr.size === 0) return;

      const prev = state.snapshot;
      state.snapshot = curr;
      if (!baseline && prev && snapshotChanged(prev, curr)) {
        this.scheduleBroadcast(state);
      }
    } finally {
      state.inFlight = false;
    }
  }

  private scheduleBroadcast(state: DirState): void {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this.onChanged();
    }, this.debounceMs);
  }

  unwatch(dirPath: string): void {
    const state = this.dirs.get(dirPath);
    if (!state) return;
    state.epoch++;
    if (state.timer) clearInterval(state.timer);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    this.dirs.delete(dirPath);
  }

  unwatchAll(): void {
    for (const dirPath of this.dirs.keys()) this.unwatch(dirPath);
  }

  get size(): number {
    return this.dirs.size;
  }
}

type StatLite = { mtimeMs: number; size: number };

export interface WslFileWatcherOptions {
  intervalMs?: number;
  onChanged: (filePath: string) => void;
  watchFile?: (
    file: string,
    opts: { interval: number },
    cb: (curr: fs.Stats, prev: fs.Stats) => void
  ) => void;
  unwatchFile?: (file: string, cb: (curr: fs.Stats, prev: fs.Stats) => void) => void;
  stat?: (file: string) => Promise<StatLite | null>;
}

interface FileEntry {
  cb: (curr: fs.Stats, prev: fs.Stats) => void;
  last: string;
}

export class WslFileWatcher {
  private byWindow = new Map<number, Set<string>>();
  private watching = new Map<string, FileEntry>();
  private intervalMs: number;
  private onChanged: (filePath: string) => void;
  private watchFileFn: NonNullable<WslFileWatcherOptions["watchFile"]>;
  private unwatchFileFn: NonNullable<WslFileWatcherOptions["unwatchFile"]>;
  private statFn: NonNullable<WslFileWatcherOptions["stat"]>;

  constructor(opts: WslFileWatcherOptions) {
    this.intervalMs = opts.intervalMs ?? 1500;
    this.onChanged = opts.onChanged;
    this.watchFileFn = opts.watchFile ?? ((file, options, cb) => fs.watchFile(file, options, cb));
    this.unwatchFileFn = opts.unwatchFile ?? ((file, cb) => fs.unwatchFile(file, cb));
    this.statFn =
      opts.stat ??
      (async (file: string) => {
        try {
          const stat = await fsp.stat(file);
          return { mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      });
  }

  setWindowFiles(windowId: number, wslPaths: string[]): void {
    this.byWindow.set(windowId, new Set(wslPaths));
    this.reconcile();
  }

  removeWindow(windowId: number): void {
    if (this.byWindow.delete(windowId)) this.reconcile();
  }

  private union(): Set<string> {
    const result = new Set<string>();
    for (const paths of this.byWindow.values()) {
      for (const filePath of paths) result.add(filePath);
    }
    return result;
  }

  private reconcile(): void {
    const allPaths = this.union();
    for (const filePath of allPaths) {
      if (!this.watching.has(filePath)) this.startWatch(filePath);
    }
    for (const filePath of this.watching.keys()) {
      if (!allPaths.has(filePath)) this.stopWatch(filePath);
    }
  }

  private startWatch(filePath: string): void {
    const entry: FileEntry = { cb: () => {}, last: "" };
    entry.cb = (curr: fs.Stats) => {
      if (!curr || curr.mtimeMs === 0) {
        entry.last = "";
        return;
      }
      const key = snapshotEntry(curr.mtimeMs, curr.size);
      if (key === entry.last) return;
      entry.last = key;
      this.onChanged(filePath);
    };
    this.watching.set(filePath, entry);
    this.watchFileFn(filePath, { interval: this.intervalMs }, entry.cb);
    void this.seed(filePath, entry);
  }

  private async seed(filePath: string, entry: FileEntry): Promise<void> {
    try {
      const stat = await this.statFn(filePath);
      if (stat && stat.mtimeMs !== 0 && entry.last === "") {
        entry.last = snapshotEntry(stat.mtimeMs, stat.size);
      }
    } catch {
      // Ignore transient file read failures.
    }
  }

  private stopWatch(filePath: string): void {
    const entry = this.watching.get(filePath);
    if (!entry) return;
    this.unwatchFileFn(filePath, entry.cb);
    this.watching.delete(filePath);
  }

  async checkWindow(windowId: number): Promise<void> {
    const paths = this.byWindow.get(windowId);
    if (!paths) return;

    for (const filePath of paths) {
      const entry = this.watching.get(filePath);
      if (!entry) continue;

      const stat = await this.statFn(filePath);
      if (!stat || stat.mtimeMs === 0) continue;

      const key = snapshotEntry(stat.mtimeMs, stat.size);
      if (key !== entry.last) {
        entry.last = key;
        this.onChanged(filePath);
      }
    }
  }

  dispose(): void {
    for (const [filePath, entry] of this.watching) {
      this.unwatchFileFn(filePath, entry.cb);
    }
    this.watching.clear();
    this.byWindow.clear();
  }

  get size(): number {
    return this.watching.size;
  }
}

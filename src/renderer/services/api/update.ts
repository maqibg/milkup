export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
  releasePageUrl: string;
  date: string;
}

export const UPDATE_REPOSITORY_URL = "https://github.com/maqibg/milkup";
export const UPDATE_RELEASES_URL = `${UPDATE_REPOSITORY_URL}/releases`;
const AUTO_UPDATE_LAST_CHECK_DAY_KEY = "milkup-auto-update-last-check-day";
const AUTO_UPDATE_DELAY_MS = 5 * 60 * 1000;

function getLocalDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasAutoCheckedToday() {
  return localStorage.getItem(AUTO_UPDATE_LAST_CHECK_DAY_KEY) === getLocalDayKey();
}

function markAutoCheckedToday() {
  localStorage.setItem(AUTO_UPDATE_LAST_CHECK_DAY_KEY, getLocalDayKey());
}

// 使用 electron-updater 的 IPC 接口
export async function checkUpdate(): Promise<UpdateInfo | null> {
  const result = await window.electronAPI.checkForUpdates();
  // result.updateInfo 包含版本信息
  if (result && result.updateInfo) {
    return {
      version: result.updateInfo.version,
      url: result.updateInfo.url, // 自定义下载逻辑需要 URL（或者主进程自己管理，但这里回传也没事）
      notes: result.updateInfo.notes || "",
      releasePageUrl: result.updateInfo.releasePageUrl || "",
      date: result.updateInfo.date,
    };
  }
  return null;
}

export function scheduleAutoUpdateCheck(options: {
  enabled: boolean;
  onAvailable: (info: UpdateInfo) => void;
}) {
  if (!options.enabled || hasAutoCheckedToday()) {
    return () => {};
  }

  const timer = window.setTimeout(async () => {
    if (hasAutoCheckedToday()) return;
    markAutoCheckedToday();

    try {
      const info = await checkUpdate();
      if (info) {
        options.onAvailable(info);
      }
    } catch (error) {
      console.error("[AutoUpdate] 自动检查更新失败:", error);
    }
  }, AUTO_UPDATE_DELAY_MS);

  return () => window.clearTimeout(timer);
}

export async function downloadUpdate() {
  return await window.electronAPI.downloadUpdate();
}

export async function cancelUpdate() {
  return await window.electronAPI.cancelUpdate();
}

export async function quitAndInstall() {
  return await window.electronAPI.quitAndInstall();
}

/**
 * 图片路径工具函数
 * 使用 milkup:// 协议 + base64 编码方案
 */

function joinPath(dir: string, relative: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  let rel = relative;
  while (rel.startsWith("./") || rel.startsWith(".\\")) {
    rel = rel.substring(2);
  }
  while (rel.startsWith("/") || rel.startsWith("\\")) {
    rel = rel.substring(1);
  }
  return (dir + sep + rel).replace(/\\/g, "/");
}

function isAbsoluteLocalPath(src: string): boolean {
  if (!src) return false;

  const platform = (window as any).electronAPI?.platform;
  if (platform === "win32") {
    return /^[a-z]:[\\/]/i.test(src) || /^\\\\[^\\]/.test(src);
  }

  return src.startsWith("/");
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }

  return btoa(binary);
}

/**
 * 将本地图片路径转换为 milkup:// URL，仅用于 DOM 渲染
 * 不修改 ProseMirror 模型的 attrs.src
 */
export function resolveImageSrc(src: string): string {
  if (!src) return src;

  // 跳过已知协议和绝对路径
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file://") ||
    src.startsWith("data:") ||
    src.startsWith("milkup://")
  ) {
    return src;
  }

  if (isAbsoluteLocalPath(src)) {
    return `milkup:///absolute/${encodeBase64(src)}`;
  }

  const currentFilePath = (window as any).__currentFilePath;
  if (!currentFilePath) return src;

  // 先解码 %20 为空格，避免 preprocessContent 的编码被双重转义
  const decodedSrc = src.replace(/%20/g, " ");
  const normalizedRelativePath = joinPath(".", decodedSrc).replace(/^\.\//, "");
  return `milkup:///${encodeBase64(currentFilePath)}/${encodeURIComponent(normalizedRelativePath)}`;
}

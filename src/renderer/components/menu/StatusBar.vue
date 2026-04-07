<script setup lang="ts">
import type { EditorViewMode } from "@/types/tab";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { toggleShowOutline } from "@/renderer/hooks/useOutline";
import useSourceCode from "@/renderer/hooks/useSourceCode";

const props = defineProps<{
  content: string;
  updateStatus?: "idle" | "downloading" | "downloaded" | "error";
  downloadProgress?: number;
  isUpdateDialogVisible?: boolean;
}>();
const emit = defineEmits<{
  (e: "restore-update"): void;
}>();

const { viewMode, setEditorViewMode, toggleSourceCode, toggleCompareView } = useSourceCode();
const mode = ref<"lines" | "chars" | "words" | "all">("chars");
const viewButtonRef = ref<HTMLElement | null>(null);
const viewMenuRef = ref<HTMLElement | null>(null);
const viewMenu = ref({
  visible: false,
  x: 0,
  y: 0,
});

const viewOptions: Array<{
  mode: EditorViewMode;
  label: string;
  icon: "markdown" | "input" | "document-copy";
}> = [
  { mode: "visual", label: "渲染视图", icon: "markdown" },
  { mode: "source", label: "源码视图", icon: "input" },
  { mode: "compare", label: "对比视图", icon: "document-copy" },
];

const displayText = computed(() => {
  const text = getMetricSourceText(props.content ?? "");
  const lines = countMarkdownLines(text);
  const chars = countMarkdownChars(text);
  const words = countWords(text);

  switch (mode.value) {
    case "lines":
      return `${lines} 行`;
    case "words":
      return `${words} 字`;
    case "all":
      return `${lines} 行 · ${chars} 字符 · ${words} 字`;
    default:
      return `${chars} 字符`;
  }
});

const viewButtonIcon = computed(() => {
  if (viewMode.value === "compare") return "document-copy";
  if (viewMode.value === "source") return "input";
  return "markdown";
});

function handleRestore() {
  emit("restore-update");
}

function cycleEditorViewMode() {
  if (viewMode.value === "visual") {
    setEditorViewMode("source");
    return;
  }
  if (viewMode.value === "source") {
    setEditorViewMode("compare");
    return;
  }
  setEditorViewMode("visual");
}

function cycleMode() {
  if (mode.value === "chars") {
    mode.value = "lines";
    return;
  }
  if (mode.value === "lines") {
    mode.value = "words";
    return;
  }
  if (mode.value === "words") {
    mode.value = "all";
    return;
  }
  mode.value = "chars";
}

async function openViewMenu(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null;
  viewMenu.value = {
    visible: true,
    x: 0,
    y: 0,
  };
  await nextTick();
  positionViewMenu(target);
}

function closeViewMenu() {
  viewMenu.value.visible = false;
}

function selectViewMode(mode: EditorViewMode) {
  setEditorViewMode(mode);
  closeViewMenu();
}

function countMarkdownLines(text: string, options = { skipEmpty: true }): number {
  if (!text) return 0;
  const rawLines = text.split(/\n{2,}|<br\s*\/?>| {2}\n/g);
  if (options.skipEmpty) {
    return rawLines.filter((line) => line.trim().length > 0).length;
  }
  return rawLines.length;
}

function countMarkdownChars(text: string): number {
  return (text.trim() || "").length;
}

function countWords(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const latinWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, "")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return cjkChars + latinWords;
}

function getMetricSourceText(text: string) {
  const base64Regex = /data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]+/g;
  return text.replaceAll("&#x20;", "").replace(base64Regex, "image");
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".view-context-menu")) return;
  closeViewMenu();
}

function positionViewMenu(target: HTMLElement | null) {
  const anchor = target ?? viewButtonRef.value;
  const menu = viewMenuRef.value;
  if (!anchor || !menu) return;

  const margin = 8;
  const gap = 6;
  const anchorRect = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 180;
  const menuHeight = menu.offsetHeight || 140;

  let x = anchorRect.left;
  let y = anchorRect.top - menuHeight - gap;

  if (y < margin) {
    y = anchorRect.bottom + gap;
  }
  if (y + menuHeight > window.innerHeight - margin) {
    y = window.innerHeight - menuHeight - margin;
  }
  if (x + menuWidth > window.innerWidth - margin) {
    x = window.innerWidth - menuWidth - margin;
  }
  if (x < margin) {
    x = margin;
  }

  viewMenu.value = {
    visible: true,
    x,
    y,
  };
}

function handleMenuToggleSource() {
  toggleSourceCode();
}

function handleMenuToggleCompare() {
  toggleCompareView();
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.electronAPI.on("view:toggleView", handleMenuToggleSource);
  window.electronAPI.on("view:toggleCompareView", handleMenuToggleCompare);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  window.electronAPI.removeListener?.("view:toggleView", handleMenuToggleSource);
  window.electronAPI.removeListener?.("view:toggleCompareView", handleMenuToggleCompare);
});
</script>

<template>
  <div class="StatusBarBox">
    <div class="left-section">
      <div class="status-actions">
        <span class="status-icon-btn" @click="toggleShowOutline()">
          <AppIcon name="List-outlined" />
        </span>
        <span
          ref="viewButtonRef"
          class="status-icon-btn"
          :class="{ active: viewMode !== 'visual' }"
          @click.stop="cycleEditorViewMode"
          @contextmenu.prevent.stop="openViewMenu"
        >
          <AppIcon :name="viewButtonIcon" />
        </span>
      </div>

      <div
        v-if="updateStatus === 'downloading' && !isUpdateDialogVisible"
        class="update-progress-bar"
        @click="handleRestore"
        title="点击恢复下载弹窗"
      >
        <AppIcon name="download" class="status-inline-icon" />
        <span>正在下载 {{ downloadProgress }}%</span>
        <div class="mini-progress-bg">
          <div class="mini-progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
        </div>
      </div>
      <div
        v-else-if="updateStatus === 'downloaded' && !isUpdateDialogVisible"
        class="update-progress-bar success"
        @click="handleRestore"
      >
        <AppIcon name="check-circle" class="status-inline-icon" />
        <span>下载完成，点击安装</span>
      </div>
    </div>

    <span class="statusBarText" @click="cycleMode">{{ displayText }}</span>
  </div>

  <Teleport to="body">
    <div
      v-if="viewMenu.visible"
      ref="viewMenuRef"
      class="view-context-menu"
      :style="{ left: `${viewMenu.x}px`, top: `${viewMenu.y}px` }"
      @click.stop
    >
      <div
        v-for="item in viewOptions"
        :key="item.mode"
        class="view-context-item"
        :class="{ active: viewMode === item.mode }"
        @click="selectViewMode(item.mode)"
      >
        <div class="view-context-main">
          <AppIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </div>
        <AppIcon v-if="viewMode === item.mode" name="check-circle" class="view-context-check" />
      </div>
    </div>
  </Teleport>
</template>

<style lang="less" scoped>
.StatusBarBox {
  user-select: none;
  font-size: 14px;
  color: var(--text-color-1);
  text-align: right;
  background: var(--background-color-2);
  display: flex;
  justify-content: space-between;
  align-items: center;

  .left-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

.status-actions {
  display: flex;
  align-items: center;
}

.status-icon-btn,
.statusBarText {
  padding: 2px 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: var(--hover-color);
  }
}

.status-icon-btn.active {
  color: var(--primary-color);
}

.statusBarText {
  font-size: 12px;
  margin: 2px 0;
  color: var(--text-color-3);
}

.update-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-color-2);
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-color);
  }

  &.success {
    color: var(--primary-color);
  }

  .mini-progress-bg {
    width: 60px;
    height: 4px;
    background: var(--border-color-1);
    border-radius: 2px;
    overflow: hidden;
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
  }
}

.view-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 164px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
  padding: 6px;
}

.view-context-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-color-1);
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--hover-background-color);
  }
}

.view-context-item.active {
  background: color-mix(in srgb, var(--primary-color) 10%, var(--background-color-2));
}

.view-context-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.view-context-check {
  color: var(--primary-color);
}
</style>

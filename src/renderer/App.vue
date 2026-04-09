<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { DEFAULT_SHORTCUTS } from "@/core";
import emitter from "@/renderer/events";
import { doesEventMatchShortcut } from "@/renderer/hooks/useShortcutConfig";
import { useContext } from "@/renderer/hooks/useContext";
import { useConfig } from "@/renderer/hooks/useConfig";
import useFont from "@/renderer/hooks/useFont";
import useOtherConfig from "@/renderer/hooks/useOtherConfig";
import { isShowOutline, toggleShowOutline } from "@/renderer/hooks/useOutline";
import { useSaveConfirmDialog } from "@/renderer/hooks/useSaveConfirmDialog";
import useSourceCode from "@/renderer/hooks/useSourceCode";
import useSpellCheck from "@/renderer/hooks/useSpellCheck";
import useTab from "@/renderer/hooks/useTab";
import useTheme from "@/renderer/hooks/useTheme";
import { useUpdateDialog } from "@/renderer/hooks/useUpdateDialog";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import { scheduleAutoUpdateCheck } from "@/renderer/services/api/update";
import { shouldAutoLoadWorkspace } from "@/renderer/utils/workspacePath";
import AIChatPanel from "./components/ai/AIChatPanel.vue";
import SaveConfirmDialog from "./components/dialogs/SaveConfirmDialog.vue";
import UpdateConfirmDialog from "./components/dialogs/UpdateConfirmDialog.vue";
import CompareEditor from "./components/editor/CompareEditor.vue";
import MilkupEditor from "./components/editor/MilkupEditor.vue";
import StatusBar from "./components/menu/StatusBar.vue";
import TitleBar from "./components/menu/TitleBar.vue";
import Outline from "./components/outline/Outline.vue";

// ✅ 应用级事件协调器（仅负责事件监听和协调）
useContext();

// ✅ 直接使用各个hooks（而不是通过useContext转发）
const { init: initTheme } = useTheme();
const { init: initFont } = useFont();
const { init: initOtherConfig } = useOtherConfig();
const { config } = useConfig();
const { openWorkSpaceByPath } = useWorkSpace();
const { toggleSourceCode, toggleCompareView } = useSourceCode();
const { init: initSpellCheck } = useSpellCheck();
const {
  currentTab,
  tabs,
  activeTabId,
  close,
  saveCurrentTab,
  cleanupTabLocalImages,
  getUnsavedTabs,
  switchToTab,
} = useTab();
const {
  isDialogVisible,
  dialogType,
  fileName,
  tabName,
  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
  showDialog,
} = useSaveConfirmDialog();
const {
  isDialogVisible: isUpdateDialogVisible,
  updateStatus,
  downloadProgress,
  handleIgnore,
  handleUpdate,
  handleMinimize,
  handleRestore,
  handleCancel: handleUpdateCancel,
  showDialog: showUpdateDialog,
} = useUpdateDialog();

// 编辑器类型：'milkdown' | 'milkup'
// 监听主进程的关闭确认事件
window.electronAPI.on("close:confirm", async () => {
  await handleSafeClose("close");
});

// 监听Tab关闭确认事件
const handleTabCloseConfirm = async (payload: any) => {
  const { tabId, tabName } = payload;
  const result = await showDialog(tabName);

  if (result === "save") {
    // 只有保存并成功才关闭
    const saved = await saveCurrentTab();
    if (saved) {
      close(tabId);
    }
  } else if (result === "discard") {
    // 放弃更改，直接关闭
    await cleanupTabLocalImages(tabs.value.find((tab) => tab.id === tabId));
    close(tabId);
  }
  // cancel 则不做任何操作
};
emitter.on("tab:close-confirm", handleTabCloseConfirm);

const onUpdateAvailable = (payload: any) => {
  const info = payload || {};

  localStorage.setItem("updateInfo", JSON.stringify(info));
  const ignoredVersion = localStorage.getItem("ignoredVersion");

  if (ignoredVersion !== info.version) {
    showUpdateDialog();
  }
};
let stopAutoUpdateCheck = () => {};
let stopAutoCheckWatch = () => {};

// 大纲侧边栏两阶段动画状态机
// closed: 隐藏 | opening: transform 滑入动画 | open: flex 正常布局 | closing-prep: 切回 transform 定位 | closing: transform 滑出动画
type OutlineState = "closed" | "opening" | "open" | "closing-prep" | "closing";
const outlineState = ref<OutlineState>(isShowOutline.value ? "open" : "closed");
const editorAreaRef = ref<HTMLElement | null>(null);
const aiChatPanelRef = ref<InstanceType<typeof AIChatPanel> | null>(null);
const isAIChatOpen = ref(false);

const editorAreaClass = computed(() => [
  `outline-${outlineState.value}`,
  { "ai-open": isAIChatOpen.value },
]);

watch(isShowOutline, async (val) => {
  if (val) {
    outlineState.value = "opening";
  } else {
    // 先瞬间切回 transform 定位（视觉位置不变，无动画）
    outlineState.value = "closing-prep";
    await nextTick();
    void editorAreaRef.value?.offsetHeight; // 强制浏览器应用样式
    outlineState.value = "closing";
  }
});

function onOutlineTransitionEnd(e: TransitionEvent) {
  if (e.propertyName !== "transform") return;
  if (outlineState.value === "opening") {
    outlineState.value = "open"; // 切换到 flex 布局，内容正常排版
  } else if (outlineState.value === "closing") {
    outlineState.value = "closed";
  }
}

function toggleAIChatPanel() {
  isAIChatOpen.value = !isAIChatOpen.value;
}

function handleCloseAIChatPanel() {
  isAIChatOpen.value = false;
}

async function handleAIAnalysisSelection(event: Event) {
  const detail = (event as CustomEvent<{ selectedText?: string }>).detail;
  const selectedText = detail?.selectedText?.trim();
  if (!selectedText) return;
  isAIChatOpen.value = true;
  await nextTick();
  await aiChatPanelRef.value?.analyzeSelection(selectedText);
}

function getShortcutKey(actionId: "toggleSourceView" | "toggleCompareView") {
  const def = DEFAULT_SHORTCUTS.find((item) => item.id === actionId);
  if (!def) return null;
  return config.value.shortcuts?.[actionId] || def.defaultKey;
}

function handleGlobalViewShortcut(event: KeyboardEvent) {
  if (event.isComposing || !currentTab.value) return;

  const target = event.target as HTMLElement | null;
  if (target?.closest(".shortcut-page")) return;

  const sourceShortcut = getShortcutKey("toggleSourceView");
  if (doesEventMatchShortcut(event, sourceShortcut)) {
    event.preventDefault();
    event.stopPropagation();
    toggleSourceCode();
    return;
  }

  const compareShortcut = getShortcutKey("toggleCompareView");
  if (doesEventMatchShortcut(event, compareShortcut)) {
    event.preventDefault();
    event.stopPropagation();
    toggleCompareView();
  }
}

onMounted(() => {
  initTheme();
  initFont();
  initOtherConfig();
  initSpellCheck();
  toggleShowOutline(Boolean(config.value.workspace?.autoExpandSidebar));
  const startupPath = config.value.workspace?.startupPath;
  if (startupPath && shouldAutoLoadWorkspace(startupPath)) {
    window.electronAPI.workspaceExists(startupPath).then((exists) => {
      if (exists) {
        openWorkSpaceByPath(startupPath);
      }
    });
  }
  stopAutoCheckWatch = watch(
    () => config.value.updates?.autoCheckEnabled ?? true,
    (enabled) => {
      stopAutoUpdateCheck();
      stopAutoUpdateCheck = scheduleAutoUpdateCheck({
        enabled,
        onAvailable: onUpdateAvailable,
      });
    },
    { immediate: true }
  );
  emitter.on("update:available", onUpdateAvailable);
  window.addEventListener("keydown", handleGlobalViewShortcut, true);
  window.addEventListener("milkup:ai-analysis", handleAIAnalysisSelection as EventListener);
});
onUnmounted(() => {
  stopAutoUpdateCheck();
  stopAutoCheckWatch();
  emitter.off("update:available", onUpdateAvailable);
  emitter.off("tab:close-confirm", handleTabCloseConfirm);
  window.removeEventListener("keydown", handleGlobalViewShortcut, true);
  window.removeEventListener("milkup:ai-analysis", handleAIAnalysisSelection as EventListener);
});

// Reuse safe close logic
async function handleSafeClose(action: "close" | "update") {
  const unsavedTabs = getUnsavedTabs();
  if (unsavedTabs.length === 0) {
    if (action === "update") {
      await window.electronAPI.quitAndInstall();
    } else {
      window.electronAPI.closeDiscard();
    }
    return;
  }

  for (const tab of unsavedTabs) {
    // 切换到该tab以便用户查看
    await switchToTab(tab.id);

    // 弹出保存确认框
    const result = await showDialog(tab.name);

    if (result === "cancel") {
      // 用户取消关闭操作，中止后续流程
      return;
    }

    if (result === "save") {
      const saved = await saveCurrentTab();
      if (!saved) {
        // 保存失败，中止关闭
        return;
      }
    } else {
      await cleanupTabLocalImages(tab);
    }
  }

  // 所有此轮检查都通过（保存或丢弃），强制关闭/更新
  if (action === "update") {
    window.electronAPI.quitAndInstall();
  } else {
    window.electronAPI.closeDiscard();
  }
}

// Overwrite handleUpdateInstall to check for unsaved changes
const handleInstall = async () => {
  await handleSafeClose("update");
};
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <!-- compare 模式使用分栏布局，其余模式保持每个 tab 独立编辑器实例 -->
    <div ref="editorAreaRef" class="editorArea" :class="editorAreaClass">
      <div class="outlineBox">
        <Outline />
      </div>
      <div class="editorBox" @transitionend="onOutlineTransitionEnd">
        <CompareEditor
          v-if="currentTab?.viewMode === 'compare' && currentTab"
          :key="currentTab.id"
          :tab="currentTab"
          :is-active="true"
        />
        <template v-else>
          <!-- Milkup 编辑器（每个 tab 独立实例） -->
          <MilkupEditor
            v-for="tab in tabs"
            :key="tab.id"
            v-show="tab.id === activeTabId"
            :tab="tab"
            :is-active="tab.id === activeTabId"
            :view-mode="tab.viewMode"
          />
        </template>
      </div>
      <div class="aiPanelBox">
        <AIChatPanel ref="aiChatPanelRef" :open="isAIChatOpen" @close="handleCloseAIChatPanel" />
      </div>
    </div>
  </div>
  <StatusBar
    :content="currentTab?.content ?? ''"
    :update-status="updateStatus"
    :download-progress="downloadProgress"
    :is-update-dialog-visible="isUpdateDialogVisible"
    :ai-chat-open="isAIChatOpen"
    @restore-update="handleRestore"
    @toggle-ai-chat="toggleAIChatPanel"
  />
  <SaveConfirmDialog
    :visible="isDialogVisible"
    :type="dialogType"
    :tab-name="tabName"
    :file-name="fileName"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
    @overwrite="handleOverwrite"
  />
  <UpdateConfirmDialog
    :visible="isUpdateDialogVisible"
    :status="updateStatus"
    :progress="downloadProgress"
    @get="handleUpdate"
    @install="handleInstall"
    @ignore="handleIgnore"
    @cancel="handleUpdateCancel"
    @minimize="handleMinimize"
  />
</template>

<style scoped lang="less">
#fontRoot {
  height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editorArea {
  --outline-width: 25%;
  --ai-panel-width: clamp(320px, 28vw, 360px);
  height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;

  // 默认：侧边栏隐藏在左侧外
  .outlineBox {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--outline-width);
    height: 100%;
    z-index: 10;
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform 0.2s ease,
      opacity 0.2s ease;
  }

  .editorBox {
    flex: 1;
    min-width: 0;
    width: 100%;
    transition: transform 0.22s ease;
  }

  .aiPanelBox {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--ai-panel-width);
    max-width: min(100%, var(--ai-panel-width));
    height: 100%;
    z-index: 12;
    opacity: 0;
    pointer-events: none;
    transition:
      transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.18s ease;
    transform: translate3d(calc(100% + 12px), 0, 0);
    will-change: transform, opacity;
  }

  // 打开动画：transform 滑入（GPU 加速，零重排）
  &.outline-opening {
    .outlineBox {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }
    .editorBox {
      transform: translateX(var(--outline-width));
    }
  }

  // 打开完成：切换为 flex 正常布局，内容区正确排版
  &.outline-open {
    .outlineBox {
      position: relative;
      transform: none;
      opacity: 1;
      pointer-events: auto;
      flex-shrink: 0;
      transition: none;
    }
    .editorBox {
      width: 0;
      min-width: 0;
      transform: none;
      transition: none;
    }
  }

  // 关闭准备：瞬间切回 transform 定位（视觉位置不变）
  &.outline-closing-prep {
    .outlineBox {
      position: absolute;
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
      transition: none;
    }
    .editorBox {
      width: 100%;
      min-width: 0;
      transform: translateX(var(--outline-width));
      transition: none;
    }
  }

  // 关闭动画：transform 滑出
  &.outline-closing {
    .outlineBox {
      position: absolute;
      transform: translateX(-100%);
      opacity: 0;
      pointer-events: none;
      transition:
        transform 0.2s ease,
        opacity 0.2s ease;
    }
    .editorBox {
      width: 100%;
      min-width: 0;
      transform: translateX(0);
      transition: transform 0.22s ease;
    }
  }

  &.ai-open {
    .aiPanelBox {
      transform: translate3d(0, 0, 0);
      opacity: 1;
      pointer-events: auto;
    }
  }
}

@media (max-width: 1280px) {
  .editorArea {
    --ai-panel-width: 340px;
  }
}

@media (max-width: 1080px) {
  .editorArea {
    --ai-panel-width: 300px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .editorArea {
    .outlineBox,
    .editorBox,
    .aiPanelBox {
      transition: none !important;
    }
  }
}
</style>

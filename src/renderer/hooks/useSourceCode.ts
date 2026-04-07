import { computed, readonly, ref, watch } from "vue";
import type { EditorViewMode } from "@/types/tab";
import emitter from "@/renderer/events";
import useTab from "./useTab";

const currentViewMode = ref<EditorViewMode>("visual");

let isListenerRegistered = false;
let isTabWatcherRegistered = false;

function normalizeViewMode(mode?: EditorViewMode): EditorViewMode {
  return mode === "source" || mode === "compare" ? mode : "visual";
}

export default function useSourceCode() {
  const { currentTab } = useTab();

  function emitModeChange(mode: EditorViewMode) {
    currentViewMode.value = mode;
    emitter.emit("editorView:changed", mode);
    emitter.emit("sourceView:changed", mode === "source");
  }

  function setEditorViewMode(mode: EditorViewMode) {
    if (!currentTab.value) return;
    const nextMode = normalizeViewMode(mode);
    if (currentTab.value.viewMode === nextMode && currentViewMode.value === nextMode) return;
    currentTab.value.viewMode = nextMode;
    emitModeChange(nextMode);
  }

  function syncModeFromCurrentTab() {
    emitModeChange(normalizeViewMode(currentTab.value?.viewMode));
  }

  function toggleSourceCode() {
    const nextMode = currentViewMode.value === "source" ? "visual" : "source";
    setEditorViewMode(nextMode);
  }

  function toggleCompareView() {
    const nextMode = currentViewMode.value === "compare" ? "visual" : "compare";
    setEditorViewMode(nextMode);
  }

  if (!isListenerRegistered) {
    emitter.on("editorView:toggleSource", toggleSourceCode);
    emitter.on("editorView:toggleCompare", toggleCompareView);
    emitter.on("editorView:set", setEditorViewMode);
    emitter.on("sourceView:toggle", toggleSourceCode);
    isListenerRegistered = true;
  }

  if (!isTabWatcherRegistered) {
    watch(currentTab, syncModeFromCurrentTab, { immediate: true });
    isTabWatcherRegistered = true;
  }

  const isShowSource = computed(() => currentViewMode.value === "source");
  const isCompareView = computed(() => currentViewMode.value === "compare");

  return {
    viewMode: readonly(currentViewMode),
    isShowSource,
    isCompareView,
    setEditorViewMode,
    toggleSourceCode,
    toggleCompareView,
  };
}

<script setup lang="ts">
import type { Tab } from "@/types/tab";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useTab from "@/renderer/hooks/useTab";
import MarkdownSourceEditor from "./MarkdownSourceEditor.vue";
import MilkupEditor from "./MilkupEditor.vue";

const props = defineProps<{
  tab: Tab;
  isActive: boolean;
}>();

const { updateCurrentTabContent, updateCurrentTabScrollRatio } = useTab();

const sourceEditorRef = ref<InstanceType<typeof MarkdownSourceEditor> | null>(null);
const visualEditorRef = ref<InstanceType<typeof MilkupEditor> | null>(null);

const sourceContent = computed({
  get: () => props.tab.content,
  set: (value: string) => {
    updateCurrentTabContent(value);
  },
});

let detachScrollSync: (() => void) | null = null;
let syncingPane: "source" | "visual" | null = null;

function getScrollRatio(el: HTMLElement) {
  const maxScrollTop = el.scrollHeight - el.clientHeight;
  return maxScrollTop <= 0 ? 0 : el.scrollTop / maxScrollTop;
}

function applyScrollRatio(el: HTMLElement, ratio: number) {
  const maxScrollTop = el.scrollHeight - el.clientHeight;
  el.scrollTop = maxScrollTop <= 0 ? 0 : maxScrollTop * ratio;
}

function teardownScrollSync() {
  detachScrollSync?.();
  detachScrollSync = null;
}

function syncPaneScroll(from: HTMLElement, to: HTMLElement, pane: "source" | "visual") {
  if (syncingPane && syncingPane !== pane) return;
  syncingPane = pane;
  const ratio = getScrollRatio(from);
  updateCurrentTabScrollRatio(ratio);
  requestAnimationFrame(() => {
    applyScrollRatio(to, ratio);
    syncingPane = null;
  });
}

function setupScrollSync() {
  const sourceEl = sourceEditorRef.value?.getScrollElement?.();
  const visualEl = visualEditorRef.value?.getScrollElement?.();
  if (!(sourceEl instanceof HTMLElement) || !(visualEl instanceof HTMLElement)) return;

  const onSourceScroll = () => syncPaneScroll(sourceEl, visualEl, "source");
  const onVisualScroll = () => syncPaneScroll(visualEl, sourceEl, "visual");

  sourceEl.addEventListener("scroll", onSourceScroll, { passive: true });
  visualEl.addEventListener("scroll", onVisualScroll, { passive: true });
  applyScrollRatio(sourceEl, props.tab.scrollRatio ?? 0);
  applyScrollRatio(visualEl, props.tab.scrollRatio ?? 0);

  detachScrollSync = () => {
    sourceEl.removeEventListener("scroll", onSourceScroll);
    visualEl.removeEventListener("scroll", onVisualScroll);
  };
}

async function refreshScrollSync() {
  teardownScrollSync();
  if (!props.isActive) return;
  await nextTick();
  setupScrollSync();
}

watch(
  () => [props.isActive, props.tab.id],
  () => {
    void refreshScrollSync();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  teardownScrollSync();
});
</script>

<template>
  <div class="compare-container">
    <div class="compare-pane compare-source">
      <div class="compare-panel">
        <div class="compare-panel-header">
          <div class="compare-panel-title">
            <AppIcon name="input" />
            <span>源码</span>
          </div>
          <span class="compare-panel-hint">Markdown</span>
        </div>
        <div class="compare-panel-body">
          <MarkdownSourceEditor
            ref="sourceEditorRef"
            v-model="sourceContent"
            :read-only="tab.readOnly"
          />
        </div>
      </div>
    </div>

    <div class="compare-pane compare-visual">
      <div class="compare-panel">
        <div class="compare-panel-header">
          <div class="compare-panel-title">
            <AppIcon name="markdown" />
            <span>渲染</span>
          </div>
          <span class="compare-panel-hint">Live Preview</span>
        </div>
        <div class="compare-panel-body compare-panel-body-visual">
          <MilkupEditor ref="visualEditorRef" :tab="tab" :is-active="isActive" view-mode="visual" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.compare-container {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  gap: 10px;
  padding: 10px;
  background: linear-gradient(180deg, var(--background-color-2), var(--background-color-1));
}

.compare-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.compare-source {
  flex: 382;
}

.compare-visual {
  flex: 618;
}

.compare-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color-1);
  border-radius: 10px;
  background: var(--background-color-1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
}

.compare-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color-1);
  background: var(--background-color-2);
  color: var(--text-color-2);
  flex-shrink: 0;
}

.compare-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-1);
}

.compare-panel-hint {
  font-size: 11px;
  color: var(--text-color-3);
  letter-spacing: 0.02em;
}

.compare-panel-body {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--background-color-1);
}

.compare-panel-body-visual {
  :deep(.scrollView) {
    background: transparent;
  }
}

.compare-panel-body :deep(.editor-container) {
  border: none;
  border-radius: 0;
}

.compare-panel-body :deep(.editor-box) {
  height: 100%;
}

.compare-panel-body :deep(.cm-focused) {
  outline: none;
}

@media (max-width: 980px) {
  .compare-container {
    flex-direction: column;
  }

  .compare-source,
  .compare-visual {
    flex: 1;
  }
}
</style>

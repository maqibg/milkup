<script setup lang="ts">
import { computed } from "vue";
import { Switch } from "@/renderer/components/ui/switch";
import { useConfig } from "@/renderer/hooks/useConfig";

const { config, setConf } = useConfig();

const matchBrackets = computed({
  get: () => config.value.other.matchBrackets ?? true,
  set: (value: boolean) => setConf("other", "matchBrackets", value),
});

const matchMarkdown = computed({
  get: () => config.value.other.matchMarkdown ?? true,
  set: (value: boolean) => setConf("other", "matchMarkdown", value),
});
</script>

<template>
  <div class="auto-pair-setting">
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-title">匹配括号和引号</span>
        <span class="setting-desc">输入 ( [ { " ' 时自动补全对应的闭合符号。</span>
      </div>
      <Switch v-model="matchBrackets" />
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-title">匹配 Markdown 字符</span>
        <span class="setting-desc">输入 * _ ~ ` = $ 时自动补全闭合符号。</span>
      </div>
      <Switch v-model="matchMarkdown" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.auto-pair-setting {
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-2);

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;

    & + .setting-row {
      border-top: 1px solid var(--border-color-1);
    }
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .setting-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  .setting-desc {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color-2);
  }
}
</style>

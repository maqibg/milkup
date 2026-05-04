<script setup lang="ts">
import { computed } from "vue";
import { Switch } from "@/renderer/components/ui/switch";
import { useConfig } from "@/renderer/hooks/useConfig";

const { config, setConf } = useConfig();

const autoSave = computed({
  get: () => config.value.other.autoSave,
  set: (value: boolean) => setConf("other", "autoSave", value),
});

const autoSaveDelay = computed({
  get: () => config.value.other.autoSaveDelay ?? 5,
  set: (value: number) => setConf("other", "autoSaveDelay", Math.max(1, value)),
});
</script>

<template>
  <div class="auto-save-setting">
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-title">自动保存</span>
        <span class="setting-desc">开启后会在已保存过的文件内容变更后自动写回磁盘。</span>
      </div>
      <Switch v-model="autoSave" />
    </div>
    <div v-if="autoSave" class="setting-row delay-row">
      <div class="setting-info">
        <span class="setting-title">无操作后自动保存</span>
        <span class="setting-desc">停止编辑后等待指定秒数再保存。</span>
      </div>
      <div class="delay-stepper">
        <button class="stepper-btn" :disabled="autoSaveDelay <= 1" @click="autoSaveDelay--">
          -
        </button>
        <input
          v-model.number="autoSaveDelay"
          type="number"
          min="1"
          max="300"
          class="stepper-input"
        />
        <button class="stepper-btn" :disabled="autoSaveDelay >= 300" @click="autoSaveDelay++">
          +
        </button>
        <span class="stepper-unit">秒</span>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.auto-save-setting {
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

  .delay-stepper {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-color-1);

    .stepper-btn {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: var(--text-color-1);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        background-color 0.15s,
        color 0.15s;

      &:hover:not(:disabled) {
        background: var(--primary-color);
        color: #fff;
      }

      &:active:not(:disabled) {
        opacity: 0.85;
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
    }

    .stepper-input {
      width: 48px;
      height: 32px;
      border: none;
      border-left: 1px solid var(--border-color-1);
      border-right: 1px solid var(--border-color-1);
      background: transparent;
      color: var(--text-color-1);
      text-align: center;
      font-size: 13px;
      font-weight: 500;
      outline: none;

      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      &:focus {
        background: color-mix(in srgb, var(--primary-color) 6%, transparent);
      }
    }

    .stepper-unit {
      font-size: 13px;
      color: var(--text-color-2);
      padding-right: 10px;
    }
  }
}
</style>

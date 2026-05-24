<script setup lang="ts">
import { computed } from "vue";
import { useConfig } from "@/renderer/hooks/useConfig";
import type { LocalPathMode } from "@/renderer/hooks/useConfig";

type PasteMethod = "local" | "base64";

const { config, setConf } = useConfig();

const pasteMethod = computed<PasteMethod>(() => config.value.image.pasteMethod);
const localPathMode = computed<LocalPathMode>(() => config.value.image.localPathMode);
const customLocalPath = computed<string>({
  get: () => config.value.image.customLocalPath,
  set: (value) => {
    setConf("image", "customLocalPath", value);
  },
});

function handleChangePasteMethod(method: PasteMethod) {
  setConf("image", "pasteMethod", method);
}

function handleChangeLocalPathMode(mode: LocalPathMode) {
  setConf("image", "localPathMode", mode);
}

function handleCustomPathChange() {
  setConf("image", "customLocalPath", customLocalPath.value?.trim() || "");
}

function isAbsoluteLocalPath(pathValue: string): boolean {
  if (!pathValue) return false;
  if (window.electronAPI.platform === "win32") {
    return /^[a-zA-Z]:[\\/]/.test(pathValue) || /^\\\\[^\\]/.test(pathValue);
  }
  return pathValue.startsWith("/");
}

async function handleSelectDirectory() {
  const defaultPath = isAbsoluteLocalPath(customLocalPath.value)
    ? customLocalPath.value
    : undefined;
  const result = await window.electronAPI.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });

  if (!result || result.canceled || result.filePaths.length === 0) return;

  customLocalPath.value = result.filePaths[0];
  handleCustomPathChange();
}
</script>

<template>
  <div class="ImageConfigBox">
    <div class="options">
      <div class="slider-track">
        <div
          class="slider-thumb"
          :style="{
            transform: pasteMethod === 'local' ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
          }"
        />
        <div
          class="option-item"
          :class="{ active: pasteMethod === 'local' }"
          @click="handleChangePasteMethod('local')"
        >
          <span>本地文件</span>
        </div>
        <div
          class="option-item"
          :class="{ active: pasteMethod === 'base64' }"
          @click="handleChangePasteMethod('base64')"
        >
          <span>转为 Base64</span>
        </div>
      </div>
    </div>
    <div class="details">
      <!-- 本地文件设置 -->
      <div v-if="pasteMethod === 'local'" class="local-path-panel">
        <div class="radio-group">
          <div class="radio-item" @click="handleChangeLocalPathMode('assets')">
            <span class="radio-dot" :class="{ checked: localPathMode === 'assets' }" />
            <span class="radio-label">复制图片到 ./assets 文件夹</span>
          </div>
          <div class="radio-item" @click="handleChangeLocalPathMode('current')">
            <span class="radio-dot" :class="{ checked: localPathMode === 'current' }" />
            <span class="radio-label">复制图片到当前文件夹 (./)</span>
          </div>
          <div class="radio-item" @click="handleChangeLocalPathMode('filename-assets')">
            <span class="radio-dot" :class="{ checked: localPathMode === 'filename-assets' }" />
            <span class="radio-label">复制图片到 ./${filename}.assets 文件夹</span>
          </div>
          <div class="radio-item" @click="handleChangeLocalPathMode('custom')">
            <span class="radio-dot" :class="{ checked: localPathMode === 'custom' }" />
            <span class="radio-label">复制到指定路径</span>
          </div>
        </div>
        <div v-if="localPathMode === 'custom'" class="custom-path-row">
          <input
            v-model="customLocalPath"
            type="text"
            placeholder="请输入绝对路径，如 D:\images"
            @change="handleCustomPathChange"
          />
          <button type="button" class="path-picker-btn" @click="handleSelectDirectory">
            选择位置
          </button>
        </div>
        <div class="path-hint">
          {{
            localPathMode === "current"
              ? "图片将保存到 Markdown 文件所在的同一目录下。"
              : localPathMode === "assets"
                ? "图片将保存到 Markdown 文件所在目录下的 assets 文件夹。"
                : localPathMode === "filename-assets"
                  ? "图片将保存到与 Markdown 文件同名的 .assets 文件夹，例如 demo.md 的图片保存到 demo.assets/。"
                  : "图片将保存到指定的绝对路径目录。"
          }}
        </div>
      </div>

      <!-- Base64 说明 -->
      <div v-if="pasteMethod === 'base64'" class="base64-description">
        图片将自动转为 base64（可能会增大文件体积）
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ImageConfigBox {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .details {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--text-color-1);

    > div {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0 10px;
      border-radius: 4px;
      gap: 12px;
    }
  }

  .local-path-panel {
    .radio-group {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;

      .radio-item {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 2px 0;

        .radio-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid var(--border-color-1);
          flex-shrink: 0;
          position: relative;
          transition: border-color 0.2s;

          &.checked {
            border-color: var(--primary-color);

            &::after {
              content: "";
              position: absolute;
              top: 2px;
              left: 2px;
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--primary-color);
            }
          }
        }

        .radio-label {
          font-size: 13px;
          color: var(--text-color-1);
        }

        &:hover .radio-dot {
          border-color: var(--primary-color);
        }
      }
    }

    .custom-path-row {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding-left: 22px;

      input {
        width: 100%;
        height: 36px;
        border: 1px solid var(--border-color-1);
        border-radius: 4px;
        outline: none;
        background-color: var(--background-color-1);
        color: var(--text-color-1);
        padding: 0 10px;
        font-size: 13px;

        &:focus {
          border-color: var(--primary-color);
        }
      }

      .path-picker-btn {
        height: 36px;
        padding: 0 14px;
        border: 1px solid var(--border-color-1);
        border-radius: 4px;
        background: var(--background-color-2);
        color: var(--text-color-1);
        cursor: pointer;
        flex-shrink: 0;
        font-size: 12px;
        transition:
          background-color 0.2s,
          border-color 0.2s,
          color 0.2s;

        &:hover {
          border-color: var(--primary-color);
        }
      }
    }
  }

  .path-hint {
    color: var(--text-color-2);
    font-size: 12px;
    line-height: 1.6;
    white-space: normal;
  }

  .options {
    width: 100%;
    display: flex;
    justify-content: flex-start;

    .slider-track {
      position: relative;
      display: inline-flex;
      background: var(--background-color-2);
      border-radius: 8px;
      padding: 4px;
      gap: 4px;
      border: 1px solid var(--border-color-1);

      .slider-thumb {
        position: absolute;
        top: 4px;
        left: 4px;
        width: 120px;
        height: calc(100% - 8px);
        background: var(--primary-color, #409eff);
        border-radius: 6px;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .option-item {
        position: relative;
        z-index: 2;
        flex: 1;
        padding: 8px 16px;
        cursor: pointer;
        user-select: none;
        transition: all 0.2s ease;
        border-radius: 6px;
        text-align: center;
        width: 120px;

        span {
          font-size: 13px;
          color: var(--text-color-2);
          transition: color 0.2s ease;
          font-weight: 500;
          display: inline-block;
        }

        &.active span {
          color: #ffffff;
        }

        &:hover:not(.active) {
          background: rgba(64, 158, 255, 0.05);
        }
      }
    }
  }

  .base64-description {
    color: var(--text-color-1);
    font-size: 13px;
    line-height: 1.6;
  }
}
</style>

<script setup lang="ts">
import autotoast from "autotoast.js";
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import LoadingIcon from "../ui/LoadingIcon.vue";
import logoSvg from "/logo.svg?url";
import emitter from "@/renderer/events";
import { useConfig } from "@/renderer/hooks/useConfig";
import {
  checkUpdate,
  UPDATE_RELEASES_URL,
  UPDATE_REPOSITORY_URL,
} from "@/renderer/services/api/update";
import { version } from "../../../../package.json";

function openByDefaultBrowser(url: string) {
  window.electronAPI.openExternal(url);
}

function isNewerVersion(stored: string, current: string): boolean {
  const storedParts = stored.replace(/^v/, "").split(".").map(Number);
  const currentParts = current.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(storedParts.length, currentParts.length); i += 1) {
    const storedValue = storedParts[i] || 0;
    const currentValue = currentParts[i] || 0;

    if (storedValue > currentValue) return true;
    if (storedValue < currentValue) return false;
  }

  return false;
}

function readStoredUpdateVersion() {
  try {
    const storedUpdateInfo = JSON.parse(localStorage.getItem("updateInfo") || "{}");
    return storedUpdateInfo.version || "";
  } catch {
    return "";
  }
}

const { config } = useConfig();
const isChecking = ref(false);
const latestVersion = ref("");

const hasNewVersion = computed(() =>
  latestVersion.value ? isNewerVersion(latestVersion.value, version) : false
);

const autoCheckEnabled = computed({
  get: () => config.value.updates?.autoCheckEnabled ?? true,
  set: (enabled: boolean) => {
    config.value = {
      ...config.value,
      updates: {
        ...config.value.updates,
        autoCheckEnabled: enabled,
      },
    };
  },
});

function toggleAutoCheck() {
  autoCheckEnabled.value = !autoCheckEnabled.value;
}

function handleUpdateAvailable(info?: { version?: string }) {
  latestVersion.value = info?.version || readStoredUpdateVersion();
}

async function handleCheckUpdate() {
  if (isChecking.value) {
    return;
  }

  isChecking.value = true;
  localStorage.removeItem("ignoredVersion");

  try {
    const info = await checkUpdate();

    if (info?.version) {
      localStorage.setItem("updateInfo", JSON.stringify(info));
      latestVersion.value = info.version;
      emitter.emit("update:available", info);
      return;
    }

    autotoast.show("当前已为最新版本", "success");
  } catch (error: any) {
    autotoast.show(`检查更新失败: ${error?.message || "Unknown error"}`, "error");
  } finally {
    isChecking.value = false;
  }
}

onMounted(() => {
  latestVersion.value = readStoredUpdateVersion();
  emitter.on("update:available", handleUpdateAvailable);
});

onUnmounted(() => {
  emitter.off("update:available", handleUpdateAvailable);
});
</script>

<template>
  <div class="AboutBox">
    <div class="brandRow">
      <h1 class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">
        <img :src="logoSvg" class="logo" /> milkup
      </h1>
    </div>

    <p class="version">
      <span>version: v{{ version }}</span>
      <span v-if="isChecking" class="updateTip loading">
        <LoadingIcon />
      </span>
      <span v-else-if="hasNewVersion" class="updateTip">new</span>
    </p>

    <div class="actionRow">
      <button type="button" class="primaryButton" :disabled="isChecking" @click="handleCheckUpdate">
        <LoadingIcon v-if="isChecking" />
        <span>{{ isChecking ? "检查中..." : "检查更新" }}</span>
      </button>
      <button
        type="button"
        class="secondaryButton"
        @click="openByDefaultBrowser(UPDATE_RELEASES_URL)"
      >
        查看发布页
      </button>
    </div>

    <div class="updateCard">
      <div class="cardText">
        <strong>自动检查更新</strong>
        <span>启动 5 分钟后检查，每天最多一次</span>
      </div>
      <button
        type="button"
        class="switchButton"
        :class="{ active: autoCheckEnabled }"
        :aria-pressed="autoCheckEnabled"
        @click="toggleAutoCheck"
      >
        <span class="switchThumb"></span>
      </button>
    </div>

    <p class="repoLink" @click="openByDefaultBrowser(UPDATE_REPOSITORY_URL)">
      <AppIcon name="github" />
      <span>maqibg/milkup</span>
    </p>

    <p class="siteLink">
      <span class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">milkup.dev</span>
    </p>

    <p>MIT Copyright © [2025] Larry Zhu</p>
    <p>
      Powered by
      <span class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">milkup core</span>
    </p>
    <p class="tip">milkup 是完全免费开源的软件</p>
  </div>
</template>

<style lang="less" scoped>
.AboutBox {
  height: 100%;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;

  .brandRow {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .version {
    margin: 0;
    font-size: 12px;
    color: var(--text-color-2);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .actionRow {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .updateCard {
    width: 100%;
    padding: 16px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-radius: 14px;
    border: 1px solid var(--border-color-1);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary-color) 8%, var(--background-color-2)),
      var(--background-color-2)
    );
  }

  .cardText {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;

    strong {
      font-size: 14px;
      color: var(--text-color);
    }

    span {
      font-size: 12px;
      color: var(--text-color-2);
      line-height: 1.5;
    }
  }

  .primaryButton,
  .secondaryButton,
  .switchButton {
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .primaryButton,
  .secondaryButton {
    min-width: 128px;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .primaryButton {
    background: var(--primary-color);
    color: white;

    &:hover:not(:disabled) {
      filter: brightness(1.05);
    }
  }

  .secondaryButton {
    background: var(--background-color-2);
    color: var(--text-color);
    border: 1px solid var(--border-color-1);

    &:hover {
      border-color: var(--border-color-2);
      background: var(--background-color-3);
    }
  }

  .switchButton {
    width: 52px;
    height: 30px;
    flex-shrink: 0;
    padding: 4px;
    border-radius: 999px;
    background: var(--border-color-1);

    &.active {
      background: var(--primary-color);
    }
  }

  .switchThumb {
    width: 22px;
    height: 22px;
    display: block;
    border-radius: 50%;
    background: white;
    transform: translateX(0);
    transition: transform 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  }

  .switchButton.active .switchThumb {
    transform: translateX(22px);
  }

  .updateTip {
    background: var(--secondary-color);
    color: white;
    font-size: 12px;
    border-radius: 4px;
    padding: 2px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &.loading {
      background: transparent;
      padding: 0;

      svg {
        font-size: 12px;
        color: var(--primary-color);
      }
    }
  }

  .repoLink {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-color);
    cursor: pointer;
    transition: color 0.2s ease;

    &:hover {
      color: var(--primary-color);
    }
  }

  .siteLink {
    margin: 0;
  }

  .tip {
    position: absolute;
    bottom: 30px;
    font-size: 10px;
    color: var(--primary-color-transparent);
  }

  h1 {
    margin: 0;
    font-size: 20px;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 .logo {
    width: 64px;
    height: 64px;
    vertical-align: middle;
    margin-right: 8px;
  }

  p {
    margin: 0;
    font-size: 14px;
    color: var(--text-color-2);
  }

  .primaryButton:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
}

@media (max-width: 768px) {
  .AboutBox {
    padding: 24px 16px 48px;
    justify-content: flex-start;

    .actionRow,
    .updateCard {
      width: 100%;
    }

    .actionRow {
      flex-direction: column;
    }

    .primaryButton,
    .secondaryButton {
      width: 100%;
    }
  }
}
</style>

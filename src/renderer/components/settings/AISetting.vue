<script setup lang="ts">
import { computed, ref, watch } from "vue";
import toast from "autotoast.js";
import { DEFAULT_SHORTCUTS } from "@/core";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import {
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_CONTINUATION_PROMPT,
  useAIConfig,
} from "@/renderer/hooks/useAIConfig";
import { formatKeyForDisplay, useShortcutConfig } from "@/renderer/hooks/useShortcutConfig";
import { AIService } from "@/renderer/services/ai";
import Input from "@renderer/components/ui/input/Input.vue";
import Selector from "@renderer/components/ui/selector/Selector.vue";
import { Slider } from "@renderer/components/ui/slider";
import { Switch } from "@renderer/components/ui/switch";

const { config, updateConfig, providerDefaultUrls: urls } = useAIConfig();
const { shortcuts } = useShortcutConfig();

const testing = ref(false);
const testResult = ref("");
const fetchedModels = ref<string[]>([]);
const loadingModels = ref(false);
const modelFetchError = ref("");

const providers = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Google Gemini", value: "gemini" },
  { label: "Ollama (Local)", value: "ollama" },
  { label: "Custom", value: "custom" },
];

const debounceOptions = [
  { label: "快 (1s)", value: "1000" },
  { label: "适中 (2s)", value: "2000" },
  { label: "慢 (3s)", value: "3000" },
];

const modelFetchSupported = computed(() =>
  ["openai", "custom", "gemini", "ollama"].includes(config.value.provider)
);

const providerItems = computed(() => providers);

const modelItems = computed(() => {
  return fetchedModels.value.map((model) => ({ label: model, value: model }));
});

const triggerShortcutLabel = computed(() => {
  const shortcut =
    shortcuts.value.find((item) => item.id === "triggerAICompletion")?.key ||
    DEFAULT_SHORTCUTS.find((item) => item.id === "triggerAICompletion")?.defaultKey ||
    "Mod-Shift-a";
  return formatKeyForDisplay(shortcut);
});

watch(
  () => config.value.provider,
  (newProvider) => {
    const defaults = Object.values(urls);
    if (!config.value.baseUrl || defaults.includes(config.value.baseUrl)) {
      updateConfig({ baseUrl: urls[newProvider] });
    }

    if (["openai", "custom", "gemini", "ollama"].includes(newProvider)) {
      void fetchModels(false);
    } else {
      fetchedModels.value = [];
      modelFetchError.value = "";
    }
  },
  { immediate: true }
);

async function fetchModels(showToast = true) {
  if (!modelFetchSupported.value) return;
  loadingModels.value = true;
  modelFetchError.value = "";
  try {
    const models = await AIService.getModels(config.value);
    fetchedModels.value = models;
    if (models.length === 0) {
      modelFetchError.value = "未获取到模型，可继续手填自定义模型。";
    }
  } catch (e) {
    console.error(e);
    fetchedModels.value = [];
    modelFetchError.value = "获取模型列表失败，可继续手填自定义模型。";
    if (showToast) {
      toast.show("获取模型列表失败", "error");
    }
  } finally {
    loadingModels.value = false;
  }
}

async function handleTest() {
  testing.value = true;
  testResult.value = "";
  try {
    const result = await AIService.testConnection(config.value);
    testResult.value = `测试成功：${result.actual}`;
  } catch (e: any) {
    toast.show(`连接出错: ${e.message}`, "error");
    testResult.value = `测试失败：${e.message}`;
  } finally {
    testing.value = false;
  }
}

function updateProvider(val: string) {
  updateConfig({ provider: val as any });
}

function updateContinuationPrompt(event: Event) {
  updateConfig({
    continuationPrompt: (event.target as HTMLTextAreaElement).value,
  });
}

function updateAnalysisPrompt(event: Event) {
  updateConfig({
    analysisPrompt: (event.target as HTMLTextAreaElement).value,
  });
}

function resetContinuationPrompt() {
  updateConfig({ continuationPrompt: DEFAULT_CONTINUATION_PROMPT });
}

function resetAnalysisPrompt() {
  updateConfig({ analysisPrompt: DEFAULT_ANALYSIS_PROMPT });
}
</script>

<template>
  <div class="AISettingPage">
    <section class="setting-card">
      <div class="card-header">
        <span class="title-badge">
          <AppIcon name="magic-wand" />
        </span>
        <div class="title-group">
          <h2 class="title">AI 设置</h2>
          <span class="desc">配置提供商、接口地址、密钥、模型以及模型拉取能力。</span>
        </div>
      </div>

      <div class="card-content">
        <div class="row">
          <Selector
            label="服务提供商"
            :model-value="config.provider"
            :items="providerItems"
            @update:model-value="updateProvider"
            class="setting-input-width"
          />
        </div>

        <div class="row">
          <Input
            label="API Base URL"
            :model-value="config.baseUrl"
            @update:model-value="(val) => updateConfig({ baseUrl: val })"
            placeholder="https://api.openai.com/v1"
            class="setting-input-width"
          />
        </div>

        <div v-if="config.provider !== 'ollama'" class="row">
          <Input
            type="text"
            label="API Key"
            :model-value="config.apiKey"
            @update:model-value="(val) => updateConfig({ apiKey: val })"
            placeholder="sk-..."
            class="setting-input-width"
          />
        </div>

        <div v-if="modelFetchSupported" class="row">
          <Selector
            label="模型列表"
            :model-value="config.model"
            :items="modelItems"
            :editable="true"
            placeholder="可从列表选择，也可直接输入自定义模型"
            @update:model-value="(val) => updateConfig({ model: val })"
            class="setting-input-width"
          />
        </div>

        <p v-if="modelFetchSupported" class="field-hint">
          支持拉取模型：OpenAI / Custom / Gemini /
          Ollama。下拉框可直接输入自定义模型，无需单独填写。
        </p>
        <p v-if="modelFetchError" class="field-hint warning">{{ modelFetchError }}</p>

        <div class="row prompt-row">
          <span class="prompt-label">分析提示词</span>
          <div class="prompt-field">
            <textarea
              class="prompt-textarea"
              :value="config.analysisPrompt"
              placeholder="自定义选中文本 AI 分析提示词"
              @input="updateAnalysisPrompt"
            ></textarea>
            <div class="prompt-actions">
              <span class="prompt-hint">
                支持
                <code v-pre>{{ selectedText }}</code> 占位；不写占位时会自动把选中文本附在末尾。
              </span>
              <button class="text-btn" type="button" @click="resetAnalysisPrompt">恢复默认</button>
            </div>
          </div>
        </div>

        <div class="actions">
          <button
            class="action-btn secondary"
            :disabled="loadingModels || !modelFetchSupported"
            @click="() => fetchModels()"
          >
            {{ loadingModels ? "拉取中..." : "拉取模型" }}
          </button>
          <button class="action-btn primary" :disabled="testing" @click="handleTest">
            {{ testing ? "测试中..." : "测试连接" }}
          </button>
          <span class="test-result" :class="{ error: testResult.includes('测试失败') }">
            {{ testResult }}
          </span>
        </div>
      </div>
    </section>

    <section class="setting-card">
      <div class="card-header">
        <span class="title-badge">
          <AppIcon name="script" />
        </span>
        <div class="title-group">
          <h2 class="title">AI 续写</h2>
          <span class="desc">控制自动续写、手动触发、延迟与随机性。</span>
        </div>
      </div>

      <div class="card-content">
        <div class="row switch-row">
          <Switch
            :model-value="config.enabled"
            @update:model-value="(val) => updateConfig({ enabled: val })"
            label="启用 AI 续写"
          />
        </div>

        <template v-if="config.enabled">
          <div class="row switch-row">
            <Switch
              :model-value="config.manualTrigger"
              @update:model-value="(val) => updateConfig({ manualTrigger: val })"
              label="手动触发模式"
            />
          </div>

          <div class="row full-width">
            <Slider
              label="随机性 (Temperature)"
              :model-value="config.temperature"
              :min="0"
              :max="1"
              :step="0.1"
              @update:model-value="(val) => updateConfig({ temperature: val })"
            />
          </div>

          <div class="row">
            <Selector
              label="触发延迟 (Debounce)"
              :model-value="String(config.debounceWait || 2000)"
              :items="debounceOptions"
              @update:model-value="(val) => updateConfig({ debounceWait: Number(val) })"
              class="setting-input-width"
            />
          </div>

          <div class="row prompt-row">
            <span class="prompt-label">续写提示词</span>
            <div class="prompt-field">
              <textarea
                class="prompt-textarea"
                :value="config.continuationPrompt"
                placeholder="自定义 AI 续写提示词"
                @input="updateContinuationPrompt"
              ></textarea>
              <div class="prompt-actions">
                <span class="prompt-hint">
                  支持 <code v-pre>{{ fileTitle }}</code
                  >、<code v-pre>{{ sectionTitle }}</code
                  >、 <code v-pre>{{ subSectionTitle }}</code
                  >、<code v-pre>{{ previousContent }}</code> 占位。
                </span>
                <button class="text-btn" type="button" @click="resetContinuationPrompt">
                  恢复默认
                </button>
              </div>
            </div>
          </div>

          <p class="field-hint">
            {{
              config.manualTrigger
                ? `手动模式已启用：不会自动触发。选中文本后，可通过右键菜单或快捷键 ${triggerShortcutLabel} 触发 AI 续写，结果会插入到选区后方。`
                : "自动模式已启用：编辑器会在停止输入后按设定延迟自动请求续写建议，按 Tab 接受建议。"
            }}
          </p>
          <p class="field-hint">AI 续写快捷键可在“快捷键”页面修改。</p>
        </template>
      </div>
    </section>
  </div>
</template>

<style lang="less" scoped>
.AISettingPage {
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 0 10px 200px;
  box-sizing: border-box;
}

.setting-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.title-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  flex-shrink: 0;
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 14%, transparent);
  font-size: 18px;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-color);
  margin: 0;
}

.desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color-2);
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-left: 54px;
}

.row {
  display: flex;
  align-items: center;

  :deep(.input-container),
  :deep(.Selector) {
    width: 100%;

    .label {
      width: 120px;
      min-width: 120px;
      font-size: 13px;
    }

    .Input,
    .selector-container {
      width: 340px;
      flex: none;
    }
  }

  &.switch-row {
    padding-left: 0;
  }

  &.full-width {
    width: 100%;
    max-width: 460px;
  }
}

.prompt-row {
  align-items: flex-start;
  gap: 10px;
}

.prompt-label {
  width: 120px;
  min-width: 120px;
  padding-top: 10px;
  font-size: 13px;
  color: var(--text-color-1);
}

.prompt-field {
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-textarea {
  width: 100%;
  min-height: 116px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-1);
  color: var(--text-color-1);
  font-size: 13px;
  line-height: 1.6;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}

.prompt-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.prompt-hint {
  flex: 1;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-3);

  code {
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px;
  }
}

.text-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
}

.action-btn {
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.field-hint {
  margin: -6px 0 0 130px;
  max-width: 560px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-3);

  &.warning {
    color: #d9822b;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  padding-left: 130px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.primary {
    background: var(--primary-color);
    color: #fff;
    border-color: transparent;
  }

  &.secondary {
    background: var(--background-color-2);
    color: var(--text-color-1);
  }
}

.test-result {
  font-size: 13px;
  color: #4caf50;
  font-weight: 500;

  &.error {
    color: #f44336;
  }
}

@media (max-width: 768px) {
  .AISettingPage {
    padding: 0 10px 160px;
  }

  .card-content,
  .actions {
    padding-left: 0;
  }

  .field-hint {
    margin-left: 0;
  }

  .prompt-row {
    flex-direction: column;
  }

  .prompt-label {
    width: auto;
    min-width: 0;
  }

  .prompt-field {
    width: 100%;
  }

  .prompt-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

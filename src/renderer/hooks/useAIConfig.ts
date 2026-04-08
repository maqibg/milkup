import { useStorage } from "@vueuse/core";
import { computed } from "vue";

export type AIProvider = "openai" | "anthropic" | "gemini" | "ollama" | "custom";

export interface AIConfig {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  debounceWait: number;
  manualTrigger: boolean;
  continuationPrompt: string;
  analysisPrompt: string;
}

export const DEFAULT_CONTINUATION_PROMPT = `上下文：
文章标题：{{fileTitle}}
大标题：{{sectionTitle}}
本小节标题：{{subSectionTitle}}
前面内容（请紧密衔接）：{{previousContent}}`;

export const DEFAULT_ANALYSIS_PROMPT = `你是一个严谨的中文文本分析助手。请基于下面的选中文本进行分析，并使用 Markdown 输出。

请按以下结构回答：
1. 核心结论：用 2-3 句话概括文本的主旨和整体质量。
2. 内容分析：从结构、逻辑、表达、语气、可读性几个方面进行点评。
3. 关键问题：指出最重要的 3 个问题或亮点，并说明依据。
4. 优化建议：给出具体、可执行的修改建议。
5. 示例改写：如适合，提供一版更好的简短改写。

要求：
- 默认使用中文。
- 结论先行，不说空话。
- 尽量引用原文中的关键词句作为依据。
- 若信息不足，明确说明不确定点。
- 保持专业、直接、易读。

选中文本：
{{selectedText}}`;

const defaultAIConfig: AIConfig = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  debounceWait: 2000,
  manualTrigger: false,
  continuationPrompt: DEFAULT_CONTINUATION_PROMPT,
  analysisPrompt: DEFAULT_ANALYSIS_PROMPT,
};

// Default URLs for providers
export const providerDefaultUrls: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
  custom: "",
};

const config = useStorage<AIConfig>("milkup-ai-config", defaultAIConfig, localStorage, {
  mergeDefaults: true,
});

function hydratePromptDefaults(value: AIConfig): AIConfig {
  return {
    ...value,
    continuationPrompt: value.continuationPrompt?.trim()
      ? value.continuationPrompt
      : DEFAULT_CONTINUATION_PROMPT,
    analysisPrompt: value.analysisPrompt?.trim() ? value.analysisPrompt : DEFAULT_ANALYSIS_PROMPT,
  };
}

const hydratedConfig = hydratePromptDefaults(config.value);
if (
  hydratedConfig.continuationPrompt !== config.value.continuationPrompt ||
  hydratedConfig.analysisPrompt !== config.value.analysisPrompt
) {
  config.value = hydratedConfig;
}

export function useAIConfig() {
  const isEnabled = computed(() => config.value.enabled);

  const updateConfig = (updates: Partial<AIConfig>) => {
    config.value = { ...config.value, ...updates };
  };

  const resetToDefault = () => {
    config.value = { ...defaultAIConfig };
  };

  return {
    config,
    isEnabled,
    updateConfig,
    resetToDefault,
    providerDefaultUrls,
  };
}

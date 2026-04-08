<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { marked } from "marked";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import LoadingIcon from "@/renderer/components/ui/LoadingIcon.vue";
import { DEFAULT_ANALYSIS_PROMPT, useAIConfig } from "@/renderer/hooks/useAIConfig";
import { AIService, type ChatMessage as AIServiceChatMessage } from "@/renderer/services/ai";

interface Props {
  open: boolean;
}

type MessageKind = "chat" | "analysis";

interface PanelMessage {
  id: string;
  role: "user" | "assistant";
  kind: MessageKind;
  content: string;
  promptContent: string;
  sourceText?: string;
  model?: string;
  error?: boolean;
}

const DANGEROUS_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "base",
  "link",
  "meta",
  "noscript",
  "template",
  "frame",
  "frameset",
]);
const DANGEROUS_URL_RE = /^\s*(javascript|vbscript|data)\s*:/i;

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "close"): void;
}>();

const { config, updateConfig } = useAIConfig();

const messages = ref<PanelMessage[]>([]);
const draft = ref("");
const loading = ref(false);
const messagesRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLElement | null>(null);
const modelKeyword = ref("");
const modelMenuMode = ref<"global" | "regenerate">("global");
const modelTargetMessageId = ref<string | null>(null);
const fetchedModels = ref<string[]>([]);
const loadingModels = ref(false);

const editingMessageId = ref<string | null>(null);
const editingDraft = ref("");
const copiedMessageId = ref<string | null>(null);
const requestController = ref<AbortController | null>(null);

const modelFetchSupported = computed(() =>
  ["openai", "custom", "gemini", "ollama"].includes(config.value.provider)
);

const currentModelLabel = computed(() => config.value.model?.trim() || "未设置模型");

const filteredModels = computed(() => {
  const query = modelKeyword.value.trim().toLowerCase();
  const currentModel = config.value.model?.trim();
  const candidates = [
    ...new Set([currentModel, ...fetchedModels.value].filter(Boolean)),
  ] as string[];

  if (!query) return candidates;
  return candidates.filter((model) => model.toLowerCase().includes(query));
});

const BASE_SYSTEM_PROMPT = `默认使用中文进行回复。

## 自我定位
- 如果这是本次会话中的第一次回复，先为自己设定一个真实世界中的专家角色，例如：
  “我将以世界著名的[具体领域]专家，曾获[真实奖项]的身份回答您的问题。”

## 说话风格
- 直言不讳，偶尔赞美，但主要用犀利幽默回应
- 可以适度吐槽，但不要失控
- 不刻意强调自己的性格，只需要照做
- 关注细节，思考有深度

## 回答规则
- 回答的重要性很高，可能直接影响用户工作成果
- 深入解析，逐步给出清晰结论和细节
- 自然交流，语言流畅，像真人
- 必要时可以使用 Markdown 表格、LaTeX 或 Graphviz 语法

## Graphviz 输出要求
- 属性必须逗号分隔，例如 [shape=record, label="数据流"]
- 每个语句单独成行并且以分号结尾
- 节点名仅允许 ASCII
- 箭头只使用 ->
- 中文标签必须显式写成 label="中文"

## 限制
- 不要使用网络搜索、知识库、MCP 功能
- 回答要能正常显示 Markdown 格式`;

marked.setOptions({
  gfm: true,
  breaks: true,
});

function sanitizeNode(node: Node) {
  const toRemove: Node[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (DANGEROUS_ELEMENTS.has(tag)) {
      toRemove.push(child);
      return;
    }

    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }

    for (const urlAttr of ["href", "src", "action", "formaction", "xlink:href"]) {
      const value = el.getAttribute(urlAttr);
      if (value && DANGEROUS_URL_RE.test(value)) {
        el.removeAttribute(urlAttr);
      }
    }

    if (tag === "a") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }

    sanitizeNode(child);
  });

  for (const child of toRemove) {
    node.removeChild(child);
  }
}

function sanitizeHtmlString(htmlContent: string) {
  const doc = new DOMParser().parseFromString(htmlContent, "text/html");
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function buildSystemPrompt(history: PanelMessage[]) {
  const isFirstReply = !history.some((message) => message.role === "assistant" && !message.error);
  return `${BASE_SYSTEM_PROMPT}

${isFirstReply ? "这是本次会话中的第一次回复，你必须先做自我定位。" : "这不是第一次回复，不要重复自我定位。"}
`;
}

function buildAnalysisPrompt(selectedText: string) {
  const template = config.value.analysisPrompt?.trim() || DEFAULT_ANALYSIS_PROMPT;
  if (template.includes("{{selectedText}}")) {
    return template.replaceAll("{{selectedText}}", selectedText);
  }
  return `${template}\n\n${selectedText}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAssistantHtml(content: string) {
  return sanitizeHtmlString(marked.parse(content) as string);
}

function renderUserHtml(content: string) {
  return escapeHtml(content).replaceAll("\n", "<br>");
}

function renderMessageHtml(message: PanelMessage) {
  return message.role === "assistant"
    ? renderAssistantHtml(message.content)
    : renderUserHtml(message.content);
}

function createMessage(
  role: "user" | "assistant",
  content: string,
  options?: Partial<Omit<PanelMessage, "id" | "role" | "content" | "promptContent" | "kind">> & {
    promptContent?: string;
    kind?: MessageKind;
  }
) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind: options?.kind || "chat",
    content,
    promptContent: options?.promptContent || content,
    sourceText: options?.sourceText,
    model: options?.model,
    error: options?.error,
  } satisfies PanelMessage;
}

function findThreadEnd(startIndex: number) {
  let end = startIndex + 1;
  while (end < messages.value.length && messages.value[end].role !== "user") {
    end += 1;
  }
  return end;
}

function messageKindLabel(message: PanelMessage) {
  return message.kind === "analysis" ? "分析" : "对话";
}

async function ensureModelsLoaded() {
  if (!modelFetchSupported.value || loadingModels.value || fetchedModels.value.length > 0) return;
  loadingModels.value = true;
  try {
    fetchedModels.value = await AIService.getModels(config.value);
  } finally {
    loadingModels.value = false;
  }
}

async function scrollToBottom() {
  await nextTick();
  const el = messagesRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function getConversationMessages(history: PanelMessage[]) {
  return history
    .filter((message) => !message.error)
    .map((message) => ({
      role: message.role,
      content: message.promptContent,
    })) satisfies AIServiceChatMessage[];
}

async function appendAssistantError(error: unknown) {
  messages.value.push(
    createMessage(
      "assistant",
      `**请求失败**\n\n${error instanceof Error ? error.message : String(error)}`,
      {
        error: true,
        model: config.value.model,
      }
    )
  );
  await scrollToBottom();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

async function runConversation(history: PanelMessage[], modelOverride?: string) {
  requestController.value?.abort();
  const controller = new AbortController();
  requestController.value = controller;
  loading.value = true;
  await scrollToBottom();

  try {
    await requestAssistantReply(history, modelOverride, controller.signal);
  } catch (error) {
    if (isAbortError(error)) return;
    await appendAssistantError(error);
  } finally {
    if (requestController.value === controller) {
      requestController.value = null;
      loading.value = false;
    }
  }
}

async function requestAssistantReply(
  history: PanelMessage[],
  modelOverride?: string,
  signal?: AbortSignal
) {
  const requestConfig = modelOverride ? { ...config.value, model: modelOverride } : config.value;
  const response = await AIService.chat(
    requestConfig,
    {
      systemPrompt: buildSystemPrompt(history),
      messages: getConversationMessages(history),
    },
    { signal }
  );

  messages.value.push(
    createMessage("assistant", response.content, {
      model: requestConfig.model,
    })
  );
  await scrollToBottom();
}

async function sendUserMessage(
  displayContent: string,
  promptContent?: string,
  options?: { kind?: MessageKind; sourceText?: string }
) {
  const userMessage = createMessage("user", displayContent, {
    promptContent,
    kind: options?.kind,
    sourceText: options?.sourceText,
  });
  messages.value.push(userMessage);
  draft.value = "";
  await runConversation(messages.value.slice(0, -1).concat(userMessage));
}

async function sendDraft() {
  const text = draft.value.trim();
  if (!text || loading.value) return;
  await sendUserMessage(text, text, { kind: "chat" });
}

async function analyzeSelection(selectedText: string) {
  const normalized = selectedText.trim();
  if (!normalized || loading.value) return;
  const preview = normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
  await sendUserMessage(`AI分析：\n\n${preview}`, buildAnalysisPrompt(normalized), {
    kind: "analysis",
    sourceText: normalized,
  });
}

function openModelMenu(mode: "global" | "regenerate", messageId: string | null = null) {
  modelMenuMode.value = mode;
  modelTargetMessageId.value = messageId;
  modelKeyword.value = "";
  modelMenuOpen.value = true;
  void ensureModelsLoaded();
}

function toggleGlobalModelMenu() {
  if (modelMenuOpen.value && modelMenuMode.value === "global") {
    modelMenuOpen.value = false;
    return;
  }
  openModelMenu("global");
}

async function selectModel(model: string) {
  const nextModel = model.trim();
  if (!nextModel) return;

  updateConfig({ model: nextModel });
  const targetId = modelTargetMessageId.value;
  const mode = modelMenuMode.value;
  modelMenuOpen.value = false;
  modelTargetMessageId.value = null;

  if (mode === "regenerate" && targetId) {
    await regenerateAssistant(targetId, nextModel);
  }
}

async function applyCustomModel() {
  const model = modelKeyword.value.trim();
  if (!model) return;
  await selectModel(model);
}

function findMessageIndex(messageId: string) {
  return messages.value.findIndex((message) => message.id === messageId);
}

async function regenerateAssistant(messageId: string, modelOverride?: string) {
  const index = findMessageIndex(messageId);
  if (index < 0 || messages.value[index].role !== "assistant" || loading.value) return;

  const history = messages.value.slice(0, index);
  messages.value = history;
  await runConversation(history, modelOverride);
}

async function retryMessage(messageId: string) {
  await regenerateAssistant(messageId);
}

async function regenerateFromUserMessage(messageId: string) {
  const index = findMessageIndex(messageId);
  if (index < 0 || messages.value[index].role !== "user" || loading.value) return;

  const history = messages.value.slice(0, index + 1);
  messages.value = history;
  await runConversation(history);
}

async function copyMessage(message: PanelMessage) {
  await navigator.clipboard.writeText(message.content);
  copiedMessageId.value = message.id;
  window.setTimeout(() => {
    if (copiedMessageId.value === message.id) {
      copiedMessageId.value = null;
    }
  }, 1500);
}

function deleteMessage(messageId: string) {
  const index = findMessageIndex(messageId);
  if (index < 0) return;

  const message = messages.value[index];
  if (editingMessageId.value === messageId) {
    cancelEditMessage();
  }
  if (message.role === "user") {
    const end = findThreadEnd(index);
    messages.value = [...messages.value.slice(0, index), ...messages.value.slice(end)];
  } else {
    messages.value = [...messages.value.slice(0, index), ...messages.value.slice(index + 1)];
  }
}

function startEditMessage(message: PanelMessage) {
  editingMessageId.value = message.id;
  editingDraft.value =
    message.kind === "analysis" && message.sourceText ? message.sourceText : message.content;
}

function cancelEditMessage() {
  editingMessageId.value = null;
  editingDraft.value = "";
}

async function saveEditedMessage(messageId: string) {
  const index = findMessageIndex(messageId);
  if (index < 0 || loading.value) return;

  const target = messages.value[index];
  const nextValue = editingDraft.value.trim();
  if (!nextValue) return;

  if (target.role === "assistant") {
    messages.value[index] = {
      ...target,
      content: nextValue,
    };
    cancelEditMessage();
    return;
  }

  const updatedUserMessage =
    target.kind === "analysis"
      ? {
          ...target,
          sourceText: nextValue,
          content: `AI分析：\n\n${nextValue.length > 220 ? `${nextValue.slice(0, 220)}...` : nextValue}`,
          promptContent: buildAnalysisPrompt(nextValue),
        }
      : {
          ...target,
          content: nextValue,
          promptContent: nextValue,
        };

  const history = [...messages.value.slice(0, index), updatedUserMessage];
  messages.value = history;
  cancelEditMessage();
  await runConversation(history);
}

function handleTextareaKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendDraft();
  }
}

function stopConversation() {
  requestController.value?.abort();
  requestController.value = null;
  loading.value = false;
}

function handlePrimaryAction() {
  if (loading.value) {
    stopConversation();
    return;
  }
  void sendDraft();
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".ai-model-menu") || target?.closest(".ai-model-button")) return;
  modelMenuOpen.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      modelMenuOpen.value = false;
      return;
    }

    void ensureModelsLoaded();
    nextTick(() => textareaRef.value?.focus());
  }
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onUnmounted(() => {
  requestController.value?.abort();
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});

defineExpose({
  sendUserMessage,
  analyzeSelection,
});
</script>

<template>
  <div class="AIChatPanel" :class="{ open: props.open }">
    <div class="panel-header">
      <div class="panel-title-box">
        <div class="panel-title">
          <AppIcon name="bot" />
          <span>AI 对话</span>
        </div>
        <div class="panel-subtitle">Markdown 渲染 · 右键可直接分析选中文本</div>
      </div>
      <button class="header-btn" type="button" title="关闭 AI 对话" @click="$emit('close')">
        <AppIcon name="close" />
      </button>
    </div>

    <div ref="messagesRef" class="panel-messages">
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <AppIcon name="bot" class="empty-icon" />
        </div>
        <p class="empty-title">开始和 AI 对话</p>
        <p class="empty-desc">
          支持多轮上下文、Markdown 回复、重试、换模型回答、复制、编辑和删除。
        </p>
      </div>

      <div
        v-for="message in messages"
        :key="message.id"
        class="message-item"
        :class="[message.role, { error: message.error }]"
      >
        <div class="message-meta">
          <div class="message-meta-left">
            <span class="message-role">{{ message.role === "assistant" ? "AI" : "你" }}</span>
            <span class="message-kind">{{ messageKindLabel(message) }}</span>
          </div>
          <span v-if="message.role === 'assistant' && message.model" class="message-model">
            {{ message.model }}
          </span>
        </div>

        <div v-if="editingMessageId === message.id" class="edit-card">
          <textarea
            v-model="editingDraft"
            class="edit-textarea"
            placeholder="编辑消息内容"
          ></textarea>
          <div class="message-actions always-show">
            <button
              class="message-action-btn primary text-btn"
              type="button"
              @click="saveEditedMessage(message.id)"
            >
              {{ message.role === "user" ? "保存并重答" : "保存" }}
            </button>
            <button class="message-action-btn text-btn" type="button" @click="cancelEditMessage">
              取消
            </button>
          </div>
        </div>

        <template v-else>
          <div class="message-body" v-html="renderMessageHtml(message)"></div>
          <div class="message-actions">
            <button
              v-if="message.role === 'user'"
              class="message-action-btn"
              type="button"
              title="重新生成回答"
              @click="regenerateFromUserMessage(message.id)"
            >
              <AppIcon name="refresh" />
            </button>
            <button
              v-if="message.role === 'assistant'"
              class="message-action-btn"
              type="button"
              title="重试"
              @click="retryMessage(message.id)"
            >
              <AppIcon name="refresh" />
            </button>
            <button
              v-if="message.role === 'assistant'"
              class="message-action-btn"
              type="button"
              title="换模型回答"
              @click="openModelMenu('regenerate', message.id)"
            >
              <AppIcon name="bot" />
            </button>
            <button
              class="message-action-btn"
              type="button"
              :title="copiedMessageId === message.id ? '已复制' : '复制'"
              @click="copyMessage(message)"
            >
              <AppIcon :name="copiedMessageId === message.id ? 'check-circle' : 'document-copy'" />
            </button>
            <button
              class="message-action-btn"
              type="button"
              title="编辑"
              @click="startEditMessage(message)"
            >
              <AppIcon name="edit" />
            </button>
            <button
              class="message-action-btn"
              type="button"
              title="删除"
              @click="deleteMessage(message.id)"
            >
              <AppIcon name="close" />
            </button>
          </div>
        </template>
      </div>

      <div v-if="loading" class="message-item assistant loading">
        <div class="message-meta">
          <div class="message-meta-left">
            <span class="message-role">AI</span>
            <span class="message-kind">处理中</span>
          </div>
          <span class="message-model">{{ currentModelLabel }}</span>
        </div>
        <div class="loading-row">
          <LoadingIcon class="loading-icon" />
          <span>正在思考...</span>
        </div>
      </div>
    </div>

    <div class="panel-footer">
      <textarea
        ref="textareaRef"
        v-model="draft"
        class="chat-input"
        placeholder="在这里输入问题，按 Enter 发送。回答支持 Markdown。"
        @keydown="handleTextareaKeydown"
      ></textarea>

      <div class="footer-actions">
        <div class="model-switcher">
          <button
            type="button"
            class="ai-model-button"
            :title="currentModelLabel"
            @click="toggleGlobalModelMenu"
          >
            <AppIcon name="bot" />
            <span class="model-button-text">{{ currentModelLabel }}</span>
            <AppIcon name="arrow-right" class="model-chevron" :class="{ open: modelMenuOpen }" />
          </button>

          <div v-if="modelMenuOpen" ref="modelMenuRef" class="ai-model-menu">
            <div class="model-menu-title">
              {{ modelMenuMode === "regenerate" ? "选择模型并重新回答" : "切换默认对话模型" }}
            </div>
            <input
              v-model="modelKeyword"
              class="model-input"
              placeholder="搜索或输入模型"
              @keydown.enter.prevent="applyCustomModel"
            />
            <div class="model-list">
              <button
                v-for="model in filteredModels"
                :key="model"
                type="button"
                class="model-option"
                :class="{ active: model === config.model }"
                @click="selectModel(model)"
              >
                <span>{{ model }}</span>
                <AppIcon
                  v-if="model === config.model"
                  name="check-circle"
                  class="model-option-check"
                />
              </button>
              <button
                v-if="modelKeyword.trim() && !filteredModels.includes(modelKeyword.trim())"
                type="button"
                class="model-option custom"
                @click="applyCustomModel"
              >
                使用输入的模型：{{ modelKeyword.trim() }}
              </button>
              <div v-if="loadingModels" class="model-empty">正在加载模型...</div>
              <div v-else-if="!filteredModels.length && !modelKeyword.trim()" class="model-empty">
                暂无模型列表，可直接输入模型名
              </div>
            </div>
          </div>
        </div>

        <button
          class="send-btn"
          :class="{ loading }"
          type="button"
          :disabled="!loading && !draft.trim()"
          :title="loading ? '中断对话' : '发送消息'"
          @click="handlePrimaryAction"
        >
          <AppIcon :name="loading ? 'stop' : 'play'" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.AIChatPanel {
  width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(
      circle at top right,
      color-mix(in srgb, var(--primary-color) 12%, transparent),
      transparent 42%
    ),
    linear-gradient(180deg, var(--background-color-1), var(--background-color-2));
  border-left: 1px solid var(--border-color-1);
  box-shadow: -16px 0 30px rgba(0, 0, 0, 0.08);
  opacity: 0;
  transform: translateX(18px) scale(0.985);
  transition:
    opacity 0.18s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, opacity;
  overflow: hidden;
}

.AIChatPanel.open {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.panel-header {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color-1) 80%, transparent);
  background: color-mix(in srgb, var(--background-color-1) 92%, #fff 8%);
  backdrop-filter: blur(14px);
}

.panel-title-box {
  min-width: 0;
  flex: 1;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-color-1);
}

.panel-subtitle {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-color-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-btn,
.send-btn,
.ai-model-button,
.model-option,
.message-action-btn {
  cursor: pointer;
}

.header-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-color-2);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
  }
}

.panel-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overscroll-behavior: contain;
}

.empty-state {
  margin: auto 0;
  padding: 22px 18px;
  border: 1px dashed color-mix(in srgb, var(--border-color-1) 90%, transparent);
  border-radius: 18px;
  text-align: center;
  background: color-mix(in srgb, var(--background-color-1) 84%, #fff 16%);
}

.empty-icon-wrap {
  width: 56px;
  height: 56px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
}

.empty-icon {
  font-size: 28px;
}

.empty-title {
  margin: 14px 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color-1);
}

.empty-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-color-3);
}

.message-item {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.user {
    align-items: flex-end;
  }

  &.assistant,
  &.error {
    align-items: flex-start;
  }
}

.message-meta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
}

.message-meta-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.message-role {
  color: var(--text-color-2);
  font-weight: 700;
}

.message-kind,
.message-model {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--background-color-2) 85%, transparent);
  color: var(--text-color-3);
}

.message-model {
  max-width: 62%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-body,
.edit-card {
  width: 100%;
  max-width: 100%;
  padding: 13px 14px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-1);
  overflow-wrap: anywhere;
  word-break: break-word;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);

  .message-item.user & {
    width: auto;
    max-width: 92%;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--primary-color) 94%, #fff 6%),
      color-mix(in srgb, var(--primary-color) 78%, #000 22%)
    );
    color: #fff;
  }

  .message-item.assistant &,
  .message-item.error & {
    background: color-mix(in srgb, var(--background-color-1) 92%, #fff 8%);
    border: 1px solid color-mix(in srgb, var(--border-color-1) 90%, transparent);
  }

  .message-item.error & {
    border-color: rgba(239, 68, 68, 0.24);
    background: rgba(239, 68, 68, 0.06);
  }
}

.message-body :deep(h1),
.message-body :deep(h2),
.message-body :deep(h3),
.message-body :deep(h4),
.message-body :deep(h5),
.message-body :deep(h6) {
  margin: 0 0 12px;
  line-height: 1.35;
  color: inherit;
}

.message-body :deep(p),
.message-body :deep(ul),
.message-body :deep(ol),
.message-body :deep(blockquote),
.message-body :deep(pre),
.message-body :deep(table) {
  margin: 0 0 12px;
}

.message-body :deep(p:last-child),
.message-body :deep(ul:last-child),
.message-body :deep(ol:last-child),
.message-body :deep(blockquote:last-child),
.message-body :deep(pre:last-child),
.message-body :deep(table:last-child) {
  margin-bottom: 0;
}

.message-body :deep(ul),
.message-body :deep(ol) {
  padding-left: 22px;
}

.message-body :deep(li + li) {
  margin-top: 4px;
}

.message-body :deep(pre) {
  padding: 11px 12px;
  border-radius: 12px;
  overflow-x: auto;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
}

.message-body :deep(code) {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 12px;
}

.message-body :deep(blockquote) {
  padding: 8px 12px;
  border-left: 3px solid var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 8%, transparent);
}

.message-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.message-body :deep(th),
.message-body :deep(td) {
  border: 1px solid var(--border-color-1);
  padding: 7px 8px;
  text-align: left;
  white-space: nowrap;
}

.message-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color-1);
  margin: 14px 0;
}

.message-body :deep(a) {
  color: var(--primary-color);
  text-decoration: underline;
}

.message-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
}

.message-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.18s ease;

  .message-item:hover &,
  &.always-show {
    opacity: 1;
  }
}

.message-item.user .message-actions {
  justify-content: flex-end;
}

.message-item.assistant .message-actions,
.message-item.error .message-actions {
  justify-content: flex-start;
}

.message-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 92%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--background-color-1) 92%, #fff 8%);
  color: var(--text-color-2);
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
    border-color: color-mix(in srgb, var(--primary-color) 45%, var(--border-color-1));
    transform: translateY(-1px);
  }

  &.primary {
    background: var(--primary-color);
    color: #fff;
    border-color: transparent;
  }

  &.text-btn {
    width: auto;
    padding: 0 12px;
    font-size: 12px;
  }
}

.edit-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--border-color-1);
  border-radius: 12px;
  background: var(--background-color-2);
  color: var(--text-color-1);
  line-height: 1.6;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}

.loading-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--background-color-1) 92%, #fff 8%);
  border: 1px solid var(--border-color-1);
  color: var(--text-color-2);
}

.loading-icon {
  font-size: 14px;
}

.panel-footer {
  flex-shrink: 0;
  padding: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border-color-1) 82%, transparent);
  background: color-mix(in srgb, var(--background-color-2) 94%, #fff 6%);
}

.chat-input {
  width: 100%;
  min-height: 96px;
  max-height: 180px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid var(--border-color-1);
  border-radius: 14px;
  background: color-mix(in srgb, var(--background-color-1) 94%, #fff 6%);
  color: var(--text-color-1);
  font-size: 13px;
  line-height: 1.6;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--primary-color-transparent);
  }
}

.footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  min-width: 0;
}

.model-switcher {
  position: relative;
  min-width: 0;
  flex: 1;
}

.ai-model-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 230px);
  padding: 8px 12px;
  border: 1px solid var(--border-color-1);
  border-radius: 999px;
  background: color-mix(in srgb, var(--background-color-1) 92%, #fff 8%);
  color: var(--text-color-1);
  font-size: 12px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background: var(--hover-background-color);
    border-color: var(--primary-color);
  }
}

.model-button-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chevron {
  font-size: 12px;
  transition: transform 0.18s ease;

  &.open {
    transform: rotate(90deg);
  }
}

.ai-model-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: 290px;
  padding: 10px;
  border: 1px solid var(--border-color-1);
  border-radius: 14px;
  background: color-mix(in srgb, var(--background-color-1) 96%, #fff 4%);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.18);
  z-index: 30;
}

.model-menu-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-color-1);
}

.model-input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-color-1);
  border-radius: 10px;
  background: var(--background-color-2);
  color: var(--text-color-1);
  margin-bottom: 8px;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}

.model-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  text-align: left;
  font-size: 12px;
  background: transparent;
  color: var(--text-color-1);

  &:hover {
    background: var(--hover-background-color);
  }

  &.active {
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    color: var(--primary-color);
  }

  &.custom {
    border: 1px dashed var(--border-color-1);
  }
}

.model-option-check {
  color: var(--primary-color);
}

.model-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-color-3);
  text-align: center;
}

.send-btn {
  width: 38px;
  height: 38px;
  min-width: 38px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--primary-color) 92%, #fff 8%),
    color-mix(in srgb, var(--primary-color) 74%, #000 26%)
  );
  color: #fff;
  font-size: 16px;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--primary-color) 18%, transparent);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    opacity 0.18s ease;

  &:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 20px color-mix(in srgb, var(--primary-color) 24%, transparent);
  }

  &.loading {
    background: color-mix(in srgb, var(--text-color-1) 82%, var(--background-color-1));
    box-shadow: none;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

@media (max-width: 1080px) {
  .AIChatPanel {
    transform: translateX(14px);
  }

  .panel-messages {
    padding-inline: 12px;
  }

  .panel-footer {
    padding: 10px;
  }

  .chat-input {
    min-height: 88px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .AIChatPanel,
  .header-btn,
  .message-actions,
  .message-action-btn,
  .chat-input,
  .ai-model-button,
  .send-btn,
  .model-chevron {
    transition: none !important;
  }
}
</style>

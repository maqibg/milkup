/**
 * Milkup AI 续写插件
 *
 * 支持两种模式：
 * 1. 自动续写：输入停顿后生成建议，Tab 接受
 * 2. 手动续写：由右键菜单或快捷键显式触发，请求完成后直接插入文本
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

/** AI 续写插件状态 */
export interface AICompletionState {
  decoration: DecorationSet;
  suggestion: string | null;
  loading: boolean;
  requestId: number;
}

type AICompletionMeta =
  | {
      type: "set-state";
      decoration: DecorationSet;
      suggestion: string | null;
      loading: boolean;
    }
  | {
      type: "manual-request";
    };

/** AI 配置 */
export interface AICompletionConfig {
  enabled: boolean;
  debounceWait: number;
  manualTrigger: boolean;
  complete: (context: AICompletionContext) => Promise<{ continuation: string } | null>;
}

/** AI 续写上下文 */
export interface AICompletionContext {
  fileTitle: string;
  previousContent: string;
  sectionTitle: string;
  subSectionTitle: string;
}

/** 插件 Key */
export const aiCompletionPluginKey = new PluginKey<AICompletionState>("milkup-ai-completion");

/**
 * 创建 AI 续写插件
 */
export function createAICompletionPlugin(getConfig: () => AICompletionConfig): Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runCompletion(view: EditorView, manualTrigger: boolean) {
    const config = getConfig();
    if (!config.enabled) return;

    const { selection, doc } = view.state;
    const insertionPos = selection.to;

    if (manualTrigger && selection.empty) return;
    if (!manualTrigger && !selection.empty) return;

    const fileTitle = (window as any).__currentFilePath
      ? (window as any).__currentFilePath.split(/[\\/]/).pop()
      : "未命名文档";

    const previousContent = manualTrigger
      ? doc.textBetween(selection.from, selection.to, "\n")
      : doc.textBetween(Math.max(0, insertionPos - 200), insertionPos, "\n");

    if (!manualTrigger && previousContent.trim().length < 5) return;
    if (manualTrigger && previousContent.trim().length === 0) return;

    const { sectionTitle, subSectionTitle } = resolveHeadingContext(doc, insertionPos);

    try {
      const result = await config.complete({
        fileTitle,
        previousContent,
        sectionTitle,
        subSectionTitle,
      });

      if (!result?.continuation) return;

      if (manualTrigger) {
        const tr = view.state.tr.insertText(result.continuation, insertionPos, insertionPos);
        view.dispatch(
          tr.setMeta(aiCompletionPluginKey, {
            type: "set-state",
            decoration: DecorationSet.empty,
            suggestion: null,
            loading: false,
          } satisfies AICompletionMeta)
        );
        return;
      }

      const widget = document.createElement("span");
      widget.textContent = result.continuation;
      widget.style.color = "var(--text-color-light, #999)";
      widget.style.opacity = "0.6";
      widget.style.pointerEvents = "none";
      widget.dataset.suggestion = result.continuation;

      const deco = Decoration.widget(insertionPos, widget, { side: 1 });
      const decoSet = DecorationSet.create(view.state.doc, [deco]);

      view.dispatch(
        view.state.tr.setMeta(aiCompletionPluginKey, {
          type: "set-state",
          decoration: decoSet,
          suggestion: result.continuation,
          loading: false,
        } satisfies AICompletionMeta)
      );
    } catch (e) {
      console.error("AI Completion failed", e);
      view.dispatch(
        view.state.tr.setMeta(aiCompletionPluginKey, {
          type: "set-state",
          decoration: DecorationSet.empty,
          suggestion: null,
          loading: false,
        } satisfies AICompletionMeta)
      );
    }
  }

  return new Plugin<AICompletionState>({
    key: aiCompletionPluginKey,

    state: {
      init() {
        return { decoration: DecorationSet.empty, suggestion: null, loading: false, requestId: 0 };
      },
      apply(tr, value) {
        if (tr.docChanged) {
          return {
            ...value,
            decoration: DecorationSet.empty,
            suggestion: null,
            loading: false,
          };
        }

        const meta = tr.getMeta(aiCompletionPluginKey) as AICompletionMeta | undefined;
        if (!meta) return value;

        if (meta.type === "manual-request") {
          return {
            ...value,
            requestId: value.requestId + 1,
            decoration: DecorationSet.empty,
            suggestion: null,
            loading: true,
          };
        }

        return {
          ...value,
          decoration: meta.decoration,
          suggestion: meta.suggestion,
          loading: meta.loading,
        };
      },
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decoration;
      },

      handleKeyDown(view, event) {
        if (event.key !== "Tab") return false;
        const state = this.getState(view.state);
        if (!state?.suggestion) return false;

        event.preventDefault();
        view.dispatch(
          view.state.tr
            .insertText(state.suggestion, view.state.selection.to)
            .setMeta(aiCompletionPluginKey, {
              type: "set-state",
              decoration: DecorationSet.empty,
              suggestion: null,
              loading: false,
            } satisfies AICompletionMeta)
        );
        return true;
      },
    },

    view(_view) {
      return {
        update: (view: EditorView, prevState) => {
          const config = getConfig();
          if (!config.enabled) return;

          const currentPluginState = aiCompletionPluginKey.getState(view.state);
          const prevPluginState = aiCompletionPluginKey.getState(prevState);
          const isManualRequest =
            (currentPluginState?.requestId ?? 0) !== (prevPluginState?.requestId ?? 0);

          if (isManualRequest) {
            void runCompletion(view, true);
            return;
          }

          if (config.manualTrigger) return;
          if (view.state.doc.eq(prevState.doc)) return;

          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            void runCompletion(view, false);
          }, config.debounceWait || 2000);
        },

        destroy() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        },
      };
    },
  });
}

function resolveHeadingContext(doc: any, to: number) {
  let sectionTitle = "未知";
  let subSectionTitle = "未知";

  const headers: { level: number; text: string }[] = [];
  doc.nodesBetween(0, to, (node: any, pos: number) => {
    if (node.type.name === "heading") {
      if (pos + node.nodeSize <= to) {
        headers.push({ level: node.attrs.level, text: node.textContent });
      }
      return false;
    }
    if (
      ["paragraph", "code_block", "blockquote", "bullet_list", "ordered_list"].includes(
        node.type.name
      )
    ) {
      return false;
    }
    return true;
  });

  if (headers.length > 0) {
    const lastHeader = headers[headers.length - 1];
    subSectionTitle = lastHeader.text;

    const parentHeader = headers
      .slice(0, -1)
      .reverse()
      .find((header) => header.level < lastHeader.level);

    if (parentHeader) {
      sectionTitle = parentHeader.text;
    } else {
      const mainHeader =
        headers.find((header) => header.level === 1) ||
        headers.find((header) => header.level === 2);
      if (mainHeader && mainHeader !== lastHeader) {
        sectionTitle = mainHeader.text;
      } else if (lastHeader.level <= 2) {
        sectionTitle = lastHeader.text;
      }
    }
  }

  return { sectionTitle, subSectionTitle };
}

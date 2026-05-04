/**
 * Milkup 自动配对插件
 *
 * 输入括号、引号、Markdown 分隔符时自动补全闭合符号
 */

import { Plugin, Selection } from "prosemirror-state";
import { decorationPluginKey } from "../decorations";

/** 括号/引号配对映射 */
const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "「": "」", // 「」
};

/** Markdown 分隔符配对映射 */
const MARKDOWN_PAIRS: Record<string, string> = {
  "`": "`",
  "*": "*",
  _: "_",
  "~": "~",
  "=": "=",
  $: "$",
};

/** 所有右符号集合（用于跳过逻辑） */
const CLOSING_CHARS = new Set(Object.values(BRACKET_PAIRS).concat(Object.values(MARKDOWN_PAIRS)));

function getConfig(): { matchBrackets: boolean; matchMarkdown: boolean } {
  try {
    const raw = localStorage.getItem("milkup-config");
    if (!raw) return { matchBrackets: true, matchMarkdown: true };
    const parsed = JSON.parse(raw);
    return {
      matchBrackets: parsed?.other?.matchBrackets ?? true,
      matchMarkdown: parsed?.other?.matchMarkdown ?? true,
    };
  } catch {
    return { matchBrackets: true, matchMarkdown: true };
  }
}

function isSourceView(state: any): boolean {
  const decoState = decorationPluginKey.getState(state);
  return decoState?.sourceView ?? false;
}

/**
 * 创建自动配对插件
 */
export function createAutoPairPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // 仅处理单个字符按键和 Backspace
        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        const { state } = view;

        // 源码视图模式下跳过
        if (isSourceView(state)) return false;

        const config = getConfig();

        // Backspace：删除配对符号
        if (event.key === "Backspace") {
          return handleBackspace(view, config);
        }

        // 获取按键对应的配对信息
        const key = event.key;
        let isLeft = false;
        let isRight = false;
        let pairChar = "";

        if (config.matchBrackets && key in BRACKET_PAIRS) {
          isLeft = true;
          pairChar = BRACKET_PAIRS[key];
        } else if (config.matchMarkdown && key in MARKDOWN_PAIRS) {
          isLeft = true;
          pairChar = MARKDOWN_PAIRS[key];
        } else if (CLOSING_CHARS.has(key)) {
          isRight = true;
        }

        if (!isLeft && !isRight) return false;

        const { from, to, empty } = state.selection;

        // 右符号跳过：光标右侧就是该符号时，跳过不重复插入
        if (isRight && empty) {
          const after = state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size));
          if (after === event.key) {
            event.preventDefault();
            const tr = state.tr;
            tr.setSelection(Selection.near(tr.doc.resolve(from + 1)));
            view.dispatch(tr);
            return true;
          }
          return false;
        }

        // 左符号处理
        if (isLeft) {
          event.preventDefault();

          if (!empty) {
            // 有选区：用配对符号包裹
            const selectedText = state.doc.textBetween(from, to);
            const tr = state.tr.insertText(key + selectedText + pairChar, from, to);
            // 光标放在选区结束后（闭合符号之后）
            tr.setSelection(Selection.near(tr.doc.resolve(from + selectedText.length + 2)));
            view.dispatch(tr);
          } else {
            // 无选区：插入配对符号，光标居中
            const tr = state.tr.insertText(key + pairChar, from);
            tr.setSelection(Selection.near(tr.doc.resolve(from + 1)));
            view.dispatch(tr);
          }
          return true;
        }

        return false;
      },
    },
  });
}

/**
 * 处理 Backspace：当光标两侧是配对符号时同时删除
 */
function handleBackspace(
  view: any,
  config: { matchBrackets: boolean; matchMarkdown: boolean }
): boolean {
  const { state } = view;
  const { from, empty } = state.selection;

  if (!empty || from === 0) return false;

  const before = state.doc.textBetween(from - 1, from);
  const after = state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size));

  if (!after) return false;

  // 检查是否是配对符号
  let isPair = false;

  if (config.matchBrackets) {
    if (BRACKET_PAIRS[before] === after) isPair = true;
  }
  if (config.matchMarkdown) {
    if (MARKDOWN_PAIRS[before] === after) isPair = true;
  }

  if (isPair) {
    view.dispatch(state.tr.insertText("", from - 1, from + 1));
    return true;
  }

  return false;
}

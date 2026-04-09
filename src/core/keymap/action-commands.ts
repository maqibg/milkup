/**
 * ShortcutActionId → ProseMirror Command 映射
 */

import { Fragment, Node as PMNode, Schema } from "prosemirror-model";
import { setBlockType, wrapIn, lift } from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { aiCompletionPluginKey } from "../plugins/ai-completion";
import { searchPluginKey } from "../plugins/search";
import { toggleSourceView, decorationPluginKey } from "../decorations";
import {
  createEnhancedToggleMark,
  createSetHeadingCommand,
  createSetParagraphCommand,
} from "../commands/enhanced-commands";
import {
  insertHorizontalRule,
  insertTable,
  insertMathBlock,
  wrapInBulletList,
  wrapInOrderedList,
} from "../commands";
import type { ShortcutActionId } from "./types";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

type BlockUnit = {
  depth: number;
  parentDepth: number;
  index: number;
  from: number;
  to: number;
  parentFrom: number;
  parentTo: number;
  node: PMNode;
  parent: PMNode;
};

type OccurrenceSelection = {
  query: string;
  from: number;
  to: number;
  synthesized: boolean;
};

const LIST_PARENT_NAMES = new Set(["bullet_list", "ordered_list", "task_list"]);
const BLOCK_CONTAINER_NAMES = new Set(["doc", "blockquote", "list_item", "task_item"]);
const WORD_CHAR_RE = /[\p{L}\p{N}_\u4e00-\u9fff-]/u;
const OCCURRENCE_SEARCH_OPTIONS = {
  caseSensitive: true,
  wholeWord: false,
  useRegex: false,
  searchInSelection: false,
  selectionRange: null,
};

function isManualAICompletionEnabled() {
  try {
    const raw = localStorage.getItem("milkup-ai-config");
    if (!raw) return false;
    const config = JSON.parse(raw);
    return Boolean(config?.enabled && config?.manualTrigger);
  } catch {
    return false;
  }
}

function createBlockUnit(state: EditorState, depth: number): BlockUnit {
  const { $from } = state.selection;
  const parentDepth = depth - 1;

  return {
    depth,
    parentDepth,
    index: $from.index(parentDepth),
    from: $from.before(depth),
    to: $from.after(depth),
    parentFrom: parentDepth > 0 ? $from.before(parentDepth) : 0,
    parentTo: parentDepth > 0 ? $from.after(parentDepth) : state.doc.content.size,
    node: $from.node(depth),
    parent: $from.node(parentDepth),
  };
}

function getCurrentBlockUnit(state: EditorState): BlockUnit | null {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const parent = $from.node(depth - 1);
    if (
      ["list_item", "task_item"].includes(node.type.name) &&
      LIST_PARENT_NAMES.has(parent.type.name)
    ) {
      return createBlockUnit(state, depth);
    }
  }

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const parent = $from.node(depth - 1);
    if (node.isBlock && BLOCK_CONTAINER_NAMES.has(parent.type.name)) {
      return createBlockUnit(state, depth);
    }
  }

  return null;
}

function getChildNodes(parent: PMNode) {
  return Array.from({ length: parent.childCount }, (_, index) => parent.child(index));
}

function getParentContentStart(unit: BlockUnit) {
  return unit.parentDepth === 0 ? 0 : unit.parentFrom + 1;
}

function getChildStart(children: PMNode[], index: number, contentStart: number) {
  let pos = contentStart;
  for (let i = 0; i < index; i += 1) {
    pos += children[i].nodeSize;
  }
  return pos;
}

function focusNear(tr: Transaction, pos: number) {
  const safePos = Math.max(0, Math.min(pos, tr.doc.content.size));
  tr.setSelection(Selection.near(tr.doc.resolve(safePos), 1));
  return tr.scrollIntoView();
}

function focusBlock(tr: Transaction, unit: BlockUnit, children: PMNode[], index: number) {
  const start = getChildStart(children, index, getParentContentStart(unit));
  return focusNear(tr, Math.min(start + 1, tr.doc.content.size));
}

function replaceParentChildren(state: EditorState, unit: BlockUnit, children: PMNode[]) {
  const tr = state.tr;
  const content = Fragment.fromArray(children);

  if (unit.parentDepth === 0) {
    tr.replaceWith(0, state.doc.content.size, content);
    return tr;
  }

  tr.replaceWith(unit.parentFrom, unit.parentTo, unit.parent.copy(content));
  return tr;
}

function copyBlockNode(node: PMNode) {
  return node.copy(node.content);
}

function createFallbackParagraph(schema: Schema) {
  return schema.nodes.paragraph.createAndFill();
}

function moveCurrentBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1
) {
  const unit = getCurrentBlockUnit(state);
  if (!unit) return false;

  const targetIndex = unit.index + direction;
  if (targetIndex < 0 || targetIndex >= unit.parent.childCount) return false;
  if (!dispatch) return true;

  const children = getChildNodes(unit.parent);
  [children[unit.index], children[targetIndex]] = [children[targetIndex], children[unit.index]];
  dispatch(focusBlock(replaceParentChildren(state, unit, children), unit, children, targetIndex));
  return true;
}

function duplicateCurrentBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1
) {
  const unit = getCurrentBlockUnit(state);
  if (!unit) return false;
  if (!dispatch) return true;

  const children = getChildNodes(unit.parent);
  const insertIndex = direction < 0 ? unit.index : unit.index + 1;
  children.splice(insertIndex, 0, copyBlockNode(unit.node));
  dispatch(focusBlock(replaceParentChildren(state, unit, children), unit, children, insertIndex));
  return true;
}

function deleteSingleListContainer(state: EditorState, unit: BlockUnit) {
  const placeholder = createFallbackParagraph(state.schema);
  if (!placeholder) return null;

  if (unit.parentDepth === 1) {
    if (state.doc.childCount > 1)
      return focusNear(state.tr.delete(unit.parentFrom, unit.parentTo), unit.parentFrom);
    return focusNear(state.tr.replaceWith(0, state.doc.content.size, placeholder), 1);
  }

  const grandParent = state.selection.$from.node(unit.parentDepth - 1);
  if (grandParent.childCount > 1) {
    return focusNear(state.tr.delete(unit.parentFrom, unit.parentTo), unit.parentFrom);
  }

  return focusNear(
    state.tr.replaceWith(unit.parentFrom, unit.parentTo, placeholder),
    unit.parentFrom + 1
  );
}

function deleteCurrentBlockCommand(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const unit = getCurrentBlockUnit(state);
  if (!unit) return false;
  if (!dispatch) return true;

  if (unit.parent.childCount > 1) {
    dispatch(focusNear(state.tr.delete(unit.from, unit.to), unit.from));
    return true;
  }

  if (LIST_PARENT_NAMES.has(unit.parent.type.name)) {
    const tr = deleteSingleListContainer(state, unit);
    if (!tr) return false;
    dispatch(tr);
    return true;
  }

  const placeholder = createFallbackParagraph(state.schema);
  if (!placeholder) return false;
  dispatch(focusNear(state.tr.replaceWith(unit.from, unit.to, placeholder), unit.from + 1));
  return true;
}

function selectCurrentBlockCommand(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const unit = getCurrentBlockUnit(state);
  if (!unit) return false;
  if (!dispatch) return true;

  if (unit.node.isTextblock && unit.to - unit.from > 2) {
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, unit.from + 1, unit.to - 1))
        .scrollIntoView()
    );
    return true;
  }

  dispatch(state.tr.setSelection(NodeSelection.create(state.doc, unit.from)).scrollIntoView());
  return true;
}

function getDocTextWithPosMap(doc: PMNode) {
  let text = "";
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i += 1) {
        posMap.push(pos + i);
        text += node.text![i];
      }
    } else if (node.isBlock && text.length > 0 && text[text.length - 1] !== "\n") {
      posMap.push(pos);
      text += "\n";
    }
    return true;
  });

  return { text, posMap };
}

function escapePlainText(query: string) {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findExactTextMatches(doc: PMNode, query: string) {
  if (!query) return [];

  const { text, posMap } = getDocTextWithPosMap(doc);
  const matches: Array<{ from: number; to: number }> = [];
  const regex = new RegExp(escapePlainText(query), "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start >= posMap.length || end - 1 >= posMap.length) continue;
    matches.push({ from: posMap[start], to: posMap[end - 1] + 1 });
  }

  return matches;
}

function isWordChar(char: string | undefined) {
  return Boolean(char && WORD_CHAR_RE.test(char));
}

function getClosestTextIndex(posMap: number[], pos: number) {
  if (!posMap.length) return -1;
  const index = posMap.findIndex((value) => value >= pos);
  return index === -1 ? posMap.length - 1 : index;
}

function getWordSelection(state: EditorState): OccurrenceSelection | null {
  const { text, posMap } = getDocTextWithPosMap(state.doc);
  const index = getClosestTextIndex(posMap, state.selection.from);
  if (index === -1) return null;

  const wordIndex = isWordChar(text[index])
    ? index
    : index > 0 && isWordChar(text[index - 1])
      ? index - 1
      : -1;
  if (wordIndex === -1) return null;

  let start = wordIndex;
  let end = wordIndex + 1;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;

  return {
    query: text.slice(start, end),
    from: posMap[start],
    to: posMap[end - 1] + 1,
    synthesized: true,
  };
}

function getOccurrenceSelection(state: EditorState): OccurrenceSelection | null {
  const { from, to, empty } = state.selection;
  if (!empty) {
    const query = state.doc.textBetween(from, to, "\n");
    if (!query.trim()) return null;
    return { query, from, to, synthesized: false };
  }
  return getWordSelection(state);
}

function getNextOccurrenceMatch(
  matches: Array<{ from: number; to: number }>,
  from: number,
  to: number
) {
  return (
    matches.find((match) => match.from > from || (match.from === from && match.to > to)) ||
    matches.find((match) => match.from !== from || match.to !== to) ||
    null
  );
}

function selectNextOccurrenceCommand(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const target = getOccurrenceSelection(state);
  if (!target) return false;
  if (!dispatch) return true;

  if (target.synthesized) {
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, target.from, target.to))
        .scrollIntoView()
    );
    return true;
  }

  const matches = findExactTextMatches(state.doc, target.query);
  const nextMatch = getNextOccurrenceMatch(matches, target.from, target.to);

  if (!nextMatch) {
    dispatch(
      state.tr.setMeta(searchPluginKey, {
        type: "setQuery",
        query: target.query,
        options: OCCURRENCE_SEARCH_OPTIONS,
      })
    );
    return true;
  }

  dispatch(
    state.tr
      .setMeta(searchPluginKey, {
        type: "setQuery",
        query: target.query,
        options: OCCURRENCE_SEARCH_OPTIONS,
      })
      .setSelection(TextSelection.create(state.doc, nextMatch.from, nextMatch.to))
      .scrollIntoView()
  );
  return true;
}

function highlightAllOccurrencesCommand(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const target = getOccurrenceSelection(state);
  if (!target || !dispatch) return Boolean(target);

  const tr = state.tr.setMeta(searchPluginKey, {
    type: "setQuery",
    query: target.query,
    options: OCCURRENCE_SEARCH_OPTIONS,
  });

  if (target.synthesized) {
    tr.setSelection(TextSelection.create(state.doc, target.from, target.to)).scrollIntoView();
  }

  dispatch(tr);
  return true;
}

/**
 * 构建 ActionId → Command 映射
 */
export function buildActionCommandMap(schema: Schema): Record<ShortcutActionId, Command> {
  const map = {} as Record<ShortcutActionId, Command>;

  if (schema.marks.strong) map.toggleStrong = createEnhancedToggleMark(schema.marks.strong);
  if (schema.marks.emphasis) map.toggleEmphasis = createEnhancedToggleMark(schema.marks.emphasis);
  if (schema.marks.code_inline)
    map.toggleCodeInline = createEnhancedToggleMark(schema.marks.code_inline);
  if (schema.marks.strikethrough)
    map.toggleStrikethrough = createEnhancedToggleMark(schema.marks.strikethrough);
  if (schema.marks.highlight)
    map.toggleHighlight = createEnhancedToggleMark(schema.marks.highlight);

  for (let level = 1; level <= 6; level += 1) {
    map[`setHeading${level}` as ShortcutActionId] = createSetHeadingCommand(level);
  }
  map.setParagraph = createSetParagraphCommand();

  if (schema.nodes.code_block) map.setCodeBlock = setBlockType(schema.nodes.code_block);
  if (schema.nodes.blockquote) map.wrapInBlockquote = wrapIn(schema.nodes.blockquote);
  map.wrapInBulletList = wrapInBulletList;
  map.wrapInOrderedList = wrapInOrderedList;
  map.liftBlock = lift;

  map.insertHorizontalRule = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const decoState = decorationPluginKey.getState(state);
    if (decoState?.sourceView) {
      if (dispatch) {
        const para = schema.nodes.paragraph.create({ hrSource: true }, schema.text("---"));
        dispatch(state.tr.replaceSelectionWith(para).scrollIntoView());
      }
      return true;
    }
    return insertHorizontalRule(state, dispatch);
  };
  map.insertTable = insertTable();
  map.insertMathBlock = insertMathBlock();

  map.toggleSourceView = toggleSourceView;
  map.triggerAICompletion = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    if (!isManualAICompletionEnabled() || state.selection.empty) return false;
    if (dispatch) {
      dispatch(state.tr.setMeta(aiCompletionPluginKey, { type: "manual-request" }));
    }
    return true;
  };
  map.selectNextOccurrence = selectNextOccurrenceCommand;
  map.highlightAllOccurrences = highlightAllOccurrencesCommand;
  map.moveBlockUp = (state, dispatch) => moveCurrentBlock(state, dispatch, -1);
  map.moveBlockDown = (state, dispatch) => moveCurrentBlock(state, dispatch, 1);
  map.duplicateBlockUp = (state, dispatch) => duplicateCurrentBlock(state, dispatch, -1);
  map.duplicateBlockDown = (state, dispatch) => duplicateCurrentBlock(state, dispatch, 1);
  map.deleteCurrentBlock = deleteCurrentBlockCommand;
  map.selectCurrentBlock = selectCurrentBlockCommand;
  map.undo = undo;
  map.redo = redo;

  return map;
}

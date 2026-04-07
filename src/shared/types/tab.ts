export type EditorViewMode = "visual" | "source" | "compare";

export interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  content: string;
  originalContent: string;
  isModified: boolean;
  scrollRatio?: number;
  viewMode?: EditorViewMode;
}

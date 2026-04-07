export type EditorViewMode = "visual" | "source" | "compare";

export interface FileTraitsDTO {
  hasBOM: boolean;
  lineEnding: "crlf" | "lf";
  hasTrailingNewline: boolean;
}

export interface TearOffTabData {
  id: string;
  name: string;
  filePath: string | null;
  content: string;
  originalContent: string;
  isModified: boolean;
  scrollRatio?: number;
  viewMode?: EditorViewMode;
  readOnly: boolean;
  fileTraits?: FileTraitsDTO;
}

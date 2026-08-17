export interface ParseOptions {
  fileDir: string;
  relativeFilePath: string;
  workspaceDir: string;
  allFiles: Set<string>;
}

export interface LanguageParser {
  parseImports(filePath: string, content: string, options: ParseOptions): string[];
  extractSymbols(filePath: string, content: string): string[];
}

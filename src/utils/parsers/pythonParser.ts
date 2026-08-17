import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

export class PythonParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const importedFiles = new Set<string>();
    const sanitized = this.stripComments(content);
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      const matchFrom = trimmed.match(/^from\s+(\.?\.?[a-zA-Z0-9_\.]+)\s+import/);
      const matchImp = trimmed.match(/^import\s+([a-zA-Z0-9_\.]+)/);

      if (matchFrom) {
        this.resolveCandidateImport(matchFrom[1], options.fileDir, options.allFiles, importedFiles);
      } else if (matchImp) {
        this.resolveCandidateImport(matchImp[1], options.fileDir, options.allFiles, importedFiles);
      }
    }

    importedFiles.delete(options.relativeFilePath);
    return Array.from(importedFiles);
  }

  public extractSymbols(filePath: string, content: string): string[] {
    const symbols: string[] = [];
    const sanitized = this.stripComments(content);
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      const pyMatch = trimmed.match(/^(class|def)\s+([A-Za-z0-9_]+)/);
      if (pyMatch) {
        symbols.push(`${pyMatch[1]} ${pyMatch[2]}`);
      }
    }

    return symbols.slice(0, 30);
  }

  private stripComments(src: string): string {
    // Strip docstrings """...""" and '''...'''
    let clean = src.replace(/"""[\s\S]*?"""/g, '').replace(/'''[\s\S]*?'''/g, '');
    // Strip single-line # comments
    clean = clean.replace(/#[^\r\n]*/g, '');
    return clean;
  }

  private resolveCandidateImport(rawImport: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
    let cleanImport = rawImport.replace(/\\/g, '/');
    if (cleanImport.startsWith('..')) {
      cleanImport = '../' + cleanImport.replace(/^\.\.+/, '');
    } else if (cleanImport.startsWith('.')) {
      cleanImport = './' + cleanImport.replace(/^\.+/, '');
    }

    const directRel = path.normalize(path.join(fileDir, cleanImport)).replace(/\\/g, '/');
    const candidates = [
      `${directRel}.py`,
      `${directRel}/__init__.py`
    ];

    for (const cand of candidates) {
      if (allFiles.has(cand)) {
        outSet.add(cand);
        return;
      }
    }

    const base = path.basename(cleanImport).replace(/\.py$/, '');
    for (const file of allFiles) {
      const fileBase = path.basename(file, path.extname(file));
      if (fileBase.toLowerCase() === base.toLowerCase()) {
        outSet.add(file);
        return;
      }
    }
  }
}

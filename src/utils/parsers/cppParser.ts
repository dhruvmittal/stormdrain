import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

export class CppParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const importedFiles = new Set<string>();
    const sanitized = this.stripComments(content);
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
      if (match) {
        const rawInc = match[1];
        this.resolveCandidateInclude(rawInc, options.fileDir, options.allFiles, importedFiles);
      }
    }

    // Also auto-pair header with matching source file if this is a header file
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.h' || ext === '.hpp' || ext === '.hh') {
      const base = path.basename(filePath, ext);
      const candidates = [
        path.normalize(path.join(options.fileDir, `${base}.cpp`)).replace(/\\/g, '/'),
        path.normalize(path.join(options.fileDir, `${base}.cc`)).replace(/\\/g, '/'),
        path.normalize(path.join(options.fileDir, `${base}.cxx`)).replace(/\\/g, '/'),
        path.normalize(path.join(options.fileDir, `${base}.c`)).replace(/\\/g, '/')
      ];
      for (const cand of candidates) {
        if (options.allFiles.has(cand)) {
          importedFiles.add(cand);
        }
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

      // Class / Struct / Enum / Union / Namespace
      const classMatch = trimmed.match(/^(?:template\s*<[^>]*>\s*)?(class|struct|enum|namespace|union)\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        symbols.push(`${classMatch[1]} ${classMatch[2]}`);
        continue;
      }

      // Function definition / declaration
      const funcMatch = trimmed.match(/^(?:inline\s+|static\s+|virtual\s+|explicit\s+)?([A-Za-z0-9_:]+[\*\s]+)+([A-Za-z0-9_]+)\s*\([^\)]*\)/);
      if (funcMatch && !trimmed.startsWith('if') && !trimmed.startsWith('while') && !trimmed.startsWith('for') && !trimmed.startsWith('switch')) {
        const name = funcMatch[2];
        if (name && name !== 'main') {
          symbols.push(`func ${name}`);
        }
      }
    }

    return symbols.slice(0, 30);
  }

  private stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  }

  private resolveCandidateInclude(rawInc: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
    const cleanInc = rawInc.replace(/\\/g, '/');
    const directRel = path.normalize(path.join(fileDir, cleanInc)).replace(/\\/g, '/');

    const candidates = [
      directRel,
      `${directRel}.h`, `${directRel}.hpp`, `${directRel}.cpp`, `${directRel}.cc`
    ];

    for (const cand of candidates) {
      if (allFiles.has(cand)) {
        outSet.add(cand);
        // Also pair header with matching source file if available
        const candExt = path.extname(cand).toLowerCase();
        if (candExt === '.h' || candExt === '.hpp') {
          const base = cand.substring(0, cand.length - candExt.length);
          for (const srcExt of ['.cpp', '.cc', '.cxx', '.c']) {
            if (allFiles.has(base + srcExt)) {
              outSet.add(base + srcExt);
            }
          }
        }
        return;
      }
    }

    // Basename fallback
    const base = path.basename(cleanInc).replace(/\.(h|hpp|cpp|cc|cxx|c)$/, '');
    for (const file of allFiles) {
      const fileBase = path.basename(file, path.extname(file));
      if (fileBase.toLowerCase() === base.toLowerCase()) {
        outSet.add(file);
        return;
      }
    }
  }
}

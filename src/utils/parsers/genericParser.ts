import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

export class GenericParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const ext = path.extname(filePath).toLowerCase();
    const importedFiles = new Set<string>();
    const sanitized = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      // Rust: mod foo; or use crate::foo;
      if (ext === '.rs') {
        const matchMod = trimmed.match(/^mod\s+([a-zA-Z0-9_]+);/);
        const matchUse = trimmed.match(/^use\s+([a-zA-Z0-9_:]+);/);
        if (matchMod) this.resolveCandidateImport(matchMod[1], options.fileDir, options.allFiles, importedFiles);
        if (matchUse) this.resolveCandidateImport(matchUse[1], options.fileDir, options.allFiles, importedFiles);
      }

      // C# / VB.NET / Java / Go: using Foo; Imports Foo; import "foo"
      if (['.cs', '.vb', '.java', '.go'].includes(ext)) {
        const matchUsing = trimmed.match(/^(?:using|Imports|import)\s+(?:["<])?([a-zA-Z0-9_\/\.]+)[">]?;?/);
        if (matchUsing) {
          this.resolveCandidateImport(matchUsing[1], options.fileDir, options.allFiles, importedFiles);
        }
      }
    }

    importedFiles.delete(options.relativeFilePath);
    return Array.from(importedFiles);
  }

  public extractSymbols(filePath: string, content: string): string[] {
    const ext = path.extname(filePath).toLowerCase();
    const symbols: string[] = [];
    const sanitized = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (ext === '.rs') {
        const rsMatch = trimmed.match(/^(pub\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
        if (rsMatch) {
          symbols.push(`${rsMatch[1] || ''}${rsMatch[2]} ${rsMatch[3]}`);
        }
      } else if (ext === '.go') {
        const goMatch = trimmed.match(/^func\s+(\([A-Za-z0-9_*\s]+\)\s+)?([A-Za-z0-9_]+)/);
        if (goMatch) {
          symbols.push(`func ${goMatch[2]}`);
        }
        const typeMatch = trimmed.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
        if (typeMatch) {
          symbols.push(`type ${typeMatch[1]} ${typeMatch[2]}`);
        }
      } else if (['.cs', '.vb', '.java'].includes(ext)) {
        const csMatch = trimmed.match(/^(public|protected|private|internal)?\s*(class|interface|struct|enum|record|namespace)\s+([A-Za-z0-9_]+)/);
        if (csMatch) {
          symbols.push(`${csMatch[2]} ${csMatch[3]}`);
        }
      }
    }

    return symbols.slice(0, 30);
  }

  private resolveCandidateImport(rawImport: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
    const cleanImport = rawImport.replace(/\\/g, '/').replace(/[\.:]/g, '/');
    const base = path.basename(cleanImport);

    for (const file of allFiles) {
      const fileBase = path.basename(file, path.extname(file));
      if (fileBase.toLowerCase() === base.toLowerCase()) {
        outSet.add(file);
        return;
      }
    }
  }
}

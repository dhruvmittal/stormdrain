import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

export class HaskellParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const importedFiles = new Set<string>();
    const sanitized = this.stripComments(content);
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      // Match: import [qualified] ["pkg"] Module.SubModule [as Alias] [(...)]
      const match = trimmed.match(/^import\s+(?:qualified\s+)?(?:\"[^\"]+\"\s+)?([A-Z][a-zA-Z0-9_]*(?:\.[A-Z][a-zA-Z0-9_]*)*)/);
      if (match) {
        const moduleName = match[1];
        this.resolveCandidateImport(moduleName, options.fileDir, options.allFiles, importedFiles);
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

      // Data / Newtype / Type synonyms
      const typeMatch = trimmed.match(/^(data|newtype|type)\s+([A-Z][a-zA-Z0-9_']*)/);
      if (typeMatch) {
        symbols.push(`${typeMatch[1]} ${typeMatch[2]}`);
        continue;
      }

      // Class
      const classMatch = trimmed.match(/^class\s+(?:.*=>\s*)?([A-Z][a-zA-Z0-9_']*)/);
      if (classMatch) {
        symbols.push(`class ${classMatch[1]}`);
        continue;
      }

      // Instance
      const instanceMatch = trimmed.match(/^instance\s+(?:.*=>\s*)?([A-Z][a-zA-Z0-9_']*(?:\s+[A-Z][a-zA-Z0-9_']*)*)/);
      if (instanceMatch) {
        symbols.push(`instance ${instanceMatch[1]}`);
        continue;
      }

      // Function type signature: identifier :: Type
      const sigMatch = trimmed.match(/^([a-z_][a-zA-Z0-9_']*)\s*::\s*(.+)$/);
      if (sigMatch) {
        symbols.push(`${sigMatch[1]} :: ${sigMatch[2].trim()}`);
        continue;
      }
    }

    return symbols.slice(0, 30);
  }

  private stripComments(src: string): string {
    // Strip block comments {- ... -} (including nested or compiler pragmas {-# ... #-})
    let clean = src.replace(/\{-[\s\S]*?-\}/g, '');
    // Strip single-line -- comments
    clean = clean.replace(/--[^\r\n]*/g, '');
    return clean;
  }

  private resolveCandidateImport(moduleName: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
    // Convert module "Lambda.Core.EngineInterface" -> "Lambda/Core/EngineInterface"
    const relModulePath = moduleName.replace(/\./g, '/');

    // 1. Direct path candidates relative to fileDir
    const directRel = path.normalize(path.join(fileDir, relModulePath)).replace(/\\/g, '/');
    const directCandidates = [
      `${directRel}.hs`,
      `${directRel}.lhs`
    ];

    for (const cand of directCandidates) {
      if (allFiles.has(cand)) {
        outSet.add(cand);
        return;
      }
    }

    // 2. Root-relative or standard project source prefix candidates
    const exactCandidates = [
      `${relModulePath}.hs`,
      `${relModulePath}.lhs`,
      `src/${relModulePath}.hs`,
      `src/${relModulePath}.lhs`,
      `app/${relModulePath}.hs`,
      `app/${relModulePath}.lhs`,
      `test/${relModulePath}.hs`,
      `test/${relModulePath}.lhs`,
      `lib/${relModulePath}.hs`,
      `lib/${relModulePath}.lhs`
    ];

    for (const cand of exactCandidates) {
      if (allFiles.has(cand)) {
        outSet.add(cand);
        return;
      }
    }

    // 3. Suffix match: any file in allFiles that ends with "/<relModulePath>.hs" or matches exactly
    const targetSuffix = `/${relModulePath}.hs`;
    const targetLhsSuffix = `/${relModulePath}.lhs`;
    for (const file of allFiles) {
      const normFile = file.replace(/\\/g, '/');
      if (normFile.endsWith(targetSuffix) || normFile.endsWith(targetLhsSuffix) || normFile === `${relModulePath}.hs` || normFile === `${relModulePath}.lhs`) {
        outSet.add(file);
        return;
      }
    }

    // 4. Base name fallback: match by base module name (e.g. EngineInterface.hs)
    const base = path.basename(relModulePath);
    for (const file of allFiles) {
      const fileBase = path.basename(file, path.extname(file));
      if (fileBase.toLowerCase() === base.toLowerCase() && (file.endsWith('.hs') || file.endsWith('.lhs'))) {
        outSet.add(file);
        return;
      }
    }
  }
}

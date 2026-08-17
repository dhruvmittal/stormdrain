import * as path from 'path';
import { LanguageParser, ParseOptions } from './types';

export class MatlabParser implements LanguageParser {
  public parseImports(filePath: string, content: string, options: ParseOptions): string[] {
    const importedFiles = new Set<string>();

    // 1. Join line continuations (...)
    const joinedContent = content.replace(/\.\.\.\s*[\r\n]+/g, ' ');

    // 2. Strip comments (% and %{ %})
    const sanitizedContent = this.stripMatlabComments(joinedContent);

    // 3. Extract subfunction names defined in this file to prevent self-loop candidates
    const localSubfunctions = this.extractLocalSubfunctions(sanitizedContent);

    // 4. Case-insensitive lookup map of workspace files: lowercase_basename_or_path -> relativePath
    const workspaceMap = this.buildWorkspaceMap(options.allFiles);

    // 5. Extract classdef inheritance (classdef Foo < Bar & Baz)
    const classMatches = sanitizedContent.matchAll(/classdef\s+(?:\([^\)]*\)\s+)?([a-zA-Z0-9_]+)(?:\s*<\s*([a-zA-Z0-9_\s&]+?))?(?=\r?\n|$)/g);
    for (const match of classMatches) {
      if (match[2]) {
        const superClasses = match[2].split('&').map(s => s.trim());
        for (const sup of superClasses) {
          this.resolveCandidate(sup, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
        }
      }
    }

    // 6. Extract import statements (import pkg.subpkg.* or import pkg.Class)
    const importMatches = sanitizedContent.matchAll(/import\s+([a-zA-Z0-9_\.\*]+)/g);
    for (const match of importMatches) {
      const raw = match[1].replace(/\.\*$/, '');
      const parts = raw.split('.');
      const candidateName = parts[parts.length - 1];
      this.resolveCandidate(candidateName, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
      
      // Also try resolving full +pkg path (+pkg/+subpkg/Class.m)
      const pkgPath = parts.map(p => `+${p}`).join('/') + '.m';
      const normPkgPath = pkgPath.toLowerCase();
      if (workspaceMap.has(normPkgPath)) {
        importedFiles.add(workspaceMap.get(normPkgPath)!);
      }
    }

    // 7. Extract run script statements (run('script.m'), run script)
    const runMatches = sanitizedContent.matchAll(/run\s*(?:\(\s*['"]([^'"]+)['"]\s*\)|\s+([a-zA-Z0-9_\/\.\\]+))/g);
    for (const match of runMatches) {
      const scriptTarget = match[1] || match[2];
      if (scriptTarget) {
        this.resolveCandidate(scriptTarget, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
      }
    }

    // 8. Extract feval calls (feval('funcName', ...))
    const fevalMatches = sanitizedContent.matchAll(/feval\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g);
    for (const match of fevalMatches) {
      this.resolveCandidate(match[1], options.fileDir, workspaceMap, localSubfunctions, importedFiles);
    }

    // 9. Extract function handles (@funcName, @(args) funcName(...))
    const handleMatches = sanitizedContent.matchAll(/@(?:[a-zA-Z0-9_]+|\([^\)]*\))\s*([a-zA-Z0-9_]+)/g);
    for (const match of handleMatches) {
      this.resolveCandidate(match[1], options.fileDir, workspaceMap, localSubfunctions, importedFiles);
    }

    // 10. Extract standard function calls funcName(...) and static/package calls pkg.func(...)
    const callMatches = sanitizedContent.matchAll(/(?:([a-zA-Z0-9_\.]+)\.)?([a-zA-Z0-9_]+)\s*\(/g);
    for (const match of callMatches) {
      const pkgPrefix = match[1];
      const funcName = match[2];
      if (pkgPrefix) {
        this.resolveCandidate(`${pkgPrefix}.${funcName}`, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
      }
      this.resolveCandidate(funcName, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
    }

    // 11. Extract command-style function calls (statement-starting identifiers followed by args)
    const lines = sanitizedContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const cmdMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_\-\.\/\'\"]+)/);
      if (cmdMatch) {
        const identifier = cmdMatch[1];
        // Exclude MATLAB keywords
        if (!['if', 'elseif', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'return', 'break', 'continue', 'global', 'persistent', 'properties', 'methods', 'events'].includes(identifier)) {
          this.resolveCandidate(identifier, options.fileDir, workspaceMap, localSubfunctions, importedFiles);
        }
      }
    }

    importedFiles.delete(options.relativeFilePath);
    return Array.from(importedFiles);
  }

  public extractSymbols(filePath: string, content: string): string[] {
    const symbols: string[] = [];
    const sanitized = this.stripMatlabComments(content);
    const lines = sanitized.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      const funcMatch = trimmed.match(/^function\s+(?:(?:\[[^\]]*\]|[a-zA-Z0-9_]+)\s*=\s*)?([a-zA-Z0-9_]+)/);
      if (funcMatch) {
        symbols.push(`function ${funcMatch[1]}`);
        continue;
      }
      const classMatch = trimmed.match(/^classdef\s+(?:\([^\)]*\)\s+)?([a-zA-Z0-9_]+)/);
      if (classMatch) {
        symbols.push(`classdef ${classMatch[1]}`);
      }
    }

    return symbols.slice(0, 30);
  }

  private stripMatlabComments(src: string): string {
    // Strip block comments %{ ... %}
    let clean = src.replace(/%\{\s*[\s\S]*?%\}/g, '');
    // Strip single-line comments % ...
    clean = clean.replace(/%[^\r\n]*/g, '');
    return clean;
  }

  private extractLocalSubfunctions(content: string): Set<string> {
    const subfuncs = new Set<string>();
    const matches = content.matchAll(/function\s+(?:(?:\[[^\]]*\]|[a-zA-Z0-9_]+)\s*=\s*)?([a-zA-Z0-9_]+)/g);
    for (const match of matches) {
      subfuncs.add(match[1].toLowerCase());
    }
    return subfuncs;
  }

  private buildWorkspaceMap(allFiles: Set<string>): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of allFiles) {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.m') {
        const baseNoExt = path.basename(file, ext).toLowerCase();
        map.set(baseNoExt, file);
        map.set(file.toLowerCase(), file);
      }
    }
    return map;
  }

  private resolveCandidate(
    candidate: string,
    fileDir: string,
    workspaceMap: Map<string, string>,
    localSubfunctions: Set<string>,
    outSet: Set<string>
  ) {
    if (!candidate) return;
    const clean = candidate.trim().replace(/\.m$/i, '');
    const lower = clean.toLowerCase();

    // Skip if it's a local subfunction in the same file
    if (localSubfunctions.has(lower)) return;

    // Check direct relative path match first
    const relPath = path.normalize(path.join(fileDir, `${clean}.m`)).replace(/\\/g, '/').toLowerCase();
    if (workspaceMap.has(relPath)) {
      outSet.add(workspaceMap.get(relPath)!);
      return;
    }

    // Check basename match in workspace (case-insensitive)
    const baseName = path.basename(lower);
    if (workspaceMap.has(baseName)) {
      outSet.add(workspaceMap.get(baseName)!);
    }
  }
}

import * as fs from 'fs';
import * as path from 'path';

export interface FileVertexMemory {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  content: string;
  tags: string[];
  imports: string[]; // List of relative file paths imported by this file
}

const SUPPORTED_EXTENSIONS = new Set([
  '.cpp', '.hpp', '.cc', '.cxx', '.c', '.h',
  '.m',
  '.py',
  '.ts', '.tsx', '.js', '.jsx',
  '.rs',
  '.go',
  '.java'
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.stormdrain', '.gemini', 'target', 'vendor', 'tmp', 'out'
]);

export function makeFileVertexId(relativePath: string): string {
  const sanitized = relativePath.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `file_${sanitized}`;
}

export function scanWorkspaceSourceFiles(workspaceDir: string): string[] {
  const normWorkspace = path.resolve(workspaceDir);
  const filePaths: string[] = [];

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            filePaths.push(path.relative(normWorkspace, fullPath));
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  walk(normWorkspace);
  return filePaths.sort();
}

export function parseFileImports(workspaceDir: string, relativeFilePath: string, allFiles: Set<string>): string[] {
  const fullPath = path.join(workspaceDir, relativeFilePath);
  if (!fs.existsSync(fullPath)) return [];

  let content = '';
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }

  const fileDir = path.dirname(relativeFilePath);
  const ext = path.extname(relativeFilePath).toLowerCase();
  const importedFiles = new Set<string>();

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // C / C++ includes: #include "utils.h" or #include <utils.h>
    if (ext === '.cpp' || ext === '.hpp' || ext === '.cc' || ext === '.cxx' || ext === '.c' || ext === '.h') {
      const match = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
      if (match) {
        const inc = match[1];
        resolveCandidateImport(inc, fileDir, allFiles, importedFiles);
      }
    }

    // MATLAB: addpath, import, or function calls
    if (ext === '.m') {
      const matchImport = trimmed.match(/^import\s+([a-zA-Z0-9_\.]+)/);
      if (matchImport) {
        resolveCandidateImport(matchImport[1], fileDir, allFiles, importedFiles);
      }
      // MATLAB includes/scripts or function call references to sibling .m files
      const matchFunc = trimmed.match(/([a-zA-Z0-9_]+)\s*\(/);
      if (matchFunc) {
        const funcName = matchFunc[1];
        resolveCandidateImport(funcName, fileDir, allFiles, importedFiles);
      }
    }

    // Python: import foo, from foo import bar, from . import foo
    if (ext === '.py') {
      const matchFrom = trimmed.match(/^from\s+(\.?\.?[a-zA-Z0-9_\.]+)\s+import/);
      const matchImp = trimmed.match(/^import\s+([a-zA-Z0-9_\.]+)/);
      if (matchFrom) {
        resolveCandidateImport(matchFrom[1], fileDir, allFiles, importedFiles);
      } else if (matchImp) {
        resolveCandidateImport(matchImp[1], fileDir, allFiles, importedFiles);
      }
    }

    // JS / TS: import ... from './foo', require('./foo')
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      const matchImport = trimmed.match(/(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      const matchRequire = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
      const target = matchImport ? matchImport[1] : (matchRequire ? matchRequire[1] : null);
      if (target) {
        resolveCandidateImport(target, fileDir, allFiles, importedFiles);
      }
    }

    // Rust: mod foo; or use crate::foo;
    if (ext === '.rs') {
      const matchMod = trimmed.match(/^mod\s+([a-zA-Z0-9_]+);/);
      const matchUse = trimmed.match(/^use\s+([a-zA-Z0-9_:]+);/);
      if (matchMod) resolveCandidateImport(matchMod[1], fileDir, allFiles, importedFiles);
      if (matchUse) resolveCandidateImport(matchUse[1], fileDir, allFiles, importedFiles);
    }
  }

  importedFiles.delete(relativeFilePath);
  return Array.from(importedFiles);
}

function resolveCandidateImport(rawImport: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
  // Normalize module path (convert dots or slashes)
  const cleanImport = rawImport.replace(/\\/g, '/');

  // Try direct relative resolve
  const directRel = path.normalize(path.join(fileDir, cleanImport)).replace(/\\/g, '/');

  const candidates = [
    directRel,
    `${directRel}.ts`, `${directRel}.tsx`, `${directRel}.js`, `${directRel}.jsx`,
    `${directRel}.cpp`, `${directRel}.hpp`, `${directRel}.c`, `${directRel}.h`,
    `${directRel}.m`, `${directRel}.py`, `${directRel}.rs`,
    `${directRel}/index.ts`, `${directRel}/index.js`, `${directRel}/mod.rs`
  ];

  for (const cand of candidates) {
    if (allFiles.has(cand)) {
      outSet.add(cand);
      return;
    }
  }

  // Also check if cleanImport matches basename of any workspace file
  const base = path.basename(cleanImport).replace(/\.(ts|js|py|m|cpp|h|hpp|rs)$/, '');
  for (const file of allFiles) {
    const fileBase = path.basename(file, path.extname(file));
    if (fileBase.toLowerCase() === base.toLowerCase()) {
      outSet.add(file);
      return;
    }
  }
}

export function generateWorkspaceFileVertices(workspaceDir: string): FileVertexMemory[] {
  const normWorkspace = path.resolve(workspaceDir);
  const relativeFiles = scanWorkspaceSourceFiles(normWorkspace);
  const allFilesSet = new Set(relativeFiles);

  const vertices: FileVertexMemory[] = [];

  for (const relFile of relativeFiles) {
    const fullPath = path.join(normWorkspace, relFile);
    const imports = parseFileImports(normWorkspace, relFile, allFilesSet);
    const ext = path.extname(relFile);
    const id = makeFileVertexId(relFile);

    let summaryText = `File Node: \`${relFile}\`\nExtension: \`${ext}\`\nImports (${imports.length}): ${imports.map(i => `\`${i}\``).join(', ') || 'None'}`;

    // Read top comment/docstring if available
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').slice(0, 15);
      const commentLines = lines.filter(l => l.trim().startsWith('//') || l.trim().startsWith('#') || l.trim().startsWith('*') || l.trim().startsWith('%'));
      if (commentLines.length > 0) {
        summaryText += `\n\n### Top Comments / Header Summary\n${commentLines.join('\n')}`;
      }
    } catch {}

    vertices.push({
      id,
      relativePath: relFile,
      absolutePath: fullPath,
      title: `[File] ${relFile}`,
      content: summaryText,
      tags: ['file-vertex', 'codebase-graph', ext.substring(1)],
      imports
    });
  }

  return vertices;
}

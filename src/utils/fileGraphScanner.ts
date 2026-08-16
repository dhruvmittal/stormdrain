import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getGitTrackedFiles, getSubmodules, summarizeSubmodule, SubmoduleInfo } from './gitUtils';
import { getParserForFile } from './parsers';

export interface FileVertexMemory {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  content: string;
  tags: string[];
  imports: string[]; // List of relative file paths imported by this file
  hash: string; // SHA-256 checksum prefix of file content
}

const SUPPORTED_EXTENSIONS = new Set([
  '.cpp', '.hpp', '.cc', '.cxx', '.c', '.h', '.hh',
  '.m',
  '.py',
  '.ts', '.tsx', '.js', '.jsx',
  '.rs',
  '.go',
  '.java', '.cs', '.vb'
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.stormdrain', '.gemini', 'target', 'vendor', 'tmp', 'out'
]);

export type SubmodulePolicy = 'dive' | 'sum';

export interface ScanOptions {
  /** Per-submodule or blanket policy. Default: 'sum' */
  submodulePolicies?: Record<string, SubmodulePolicy> | SubmodulePolicy;
}

export function makeFileVertexId(relativePath: string): string {
  const sanitized = relativePath.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `file_${sanitized}`;
}

/**
 * Scan workspace source files. Uses `git ls-files` when available to respect
 * .gitignore rules. Falls back to filesystem walk with IGNORED_DIRS heuristic.
 */
export function scanWorkspaceSourceFiles(workspaceDir: string, submodulePaths?: Set<string>): string[] {
  const normWorkspace = path.resolve(workspaceDir);
  const home = path.resolve(os.homedir());
  const root = path.parse(normWorkspace).root;

  if (normWorkspace === home || normWorkspace === root || normWorkspace === '/root' || normWorkspace === '/home') {
    throw new Error(`Cannot scan root or user home directory "${normWorkspace}" directly without explicit subpath scoping.`);
  }

  // Try git-aware listing first
  const gitFiles = getGitTrackedFiles(normWorkspace);
  if (gitFiles) {
    // Filter to supported extensions and exclude submodule internals (for 'sum' submodules)
    const filtered = gitFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) return false;

      // If this file is inside a submodule marked for 'sum', exclude it
      if (submodulePaths && submodulePaths.size > 0) {
        for (const subPath of submodulePaths) {
          if (f === subPath || f.startsWith(subPath + '/')) {
            return false;
          }
        }
      }

      return true;
    });

    return filtered.sort();
  }

  // Fallback: filesystem walk with IGNORED_DIRS
  const filePaths: string[] = [];

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        // Skip submodule dirs that are marked for 'sum'
        if (entry.isDirectory() && submodulePaths) {
          const rel = path.relative(normWorkspace, fullPath);
          if (submodulePaths.has(rel)) continue;
        }

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
  const parser = getParserForFile(relativeFilePath);
  return parser.parseImports(relativeFilePath, content, {
    fileDir,
    relativeFilePath,
    workspaceDir,
    allFiles
  });
}

function resolveCandidateImport(rawImport: string, fileDir: string, allFiles: Set<string>, outSet: Set<string>) {
  // Normalize module path (convert dots or slashes)
  let cleanImport = rawImport.replace(/\\/g, '/');

  // Handle Python relative dot imports (e.g. .utils -> ./utils, ..utils -> ../utils)
  if (cleanImport.startsWith('..')) {
    cleanImport = '../' + cleanImport.replace(/^\.\.+/, '');
  } else if (cleanImport.startsWith('.')) {
    cleanImport = './' + cleanImport.replace(/^\.+/, '');
  }

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

export function generateWorkspaceFileVertices(
  workspaceDir: string,
  options?: ScanOptions
): FileVertexMemory[] {
  const normWorkspace = path.resolve(workspaceDir);
  
  // Detect submodules and determine policies
  const submodules = getSubmodules(normWorkspace);
  const submoduleSumPaths = new Set<string>();
  const submoduleDivePaths = new Set<string>();

  for (const sub of submodules) {
    const policy = resolveSubmodulePolicy(sub.path, options?.submodulePolicies);
    if (policy === 'sum') {
      submoduleSumPaths.add(sub.path);
    } else {
      submoduleDivePaths.add(sub.path);
    }
  }

  const relativeFiles = scanWorkspaceSourceFiles(normWorkspace, submoduleSumPaths);
  const allFilesSet = new Set(relativeFiles);

  const vertices: FileVertexMemory[] = [];

  // Generate vertices for regular source files
  for (const relFile of relativeFiles) {
    const fullPath = path.join(normWorkspace, relFile);
    const imports = parseFileImports(normWorkspace, relFile, allFilesSet);
    const ext = path.extname(relFile);
    const id = makeFileVertexId(relFile);

    let fileHash = '';
    try {
      const rawBuf = fs.readFileSync(fullPath);
      fileHash = crypto.createHash('sha256').update(rawBuf).digest('hex').substring(0, 16);
    } catch {}

    let summaryText = `File Node: \`${relFile}\`\nExtension: \`${ext}\`\nHash: \`${fileHash}\`\nImports (${imports.length}): ${imports.map(i => `\`${i}\``).join(', ') || 'None'}`;

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
      imports,
      hash: fileHash
    });
  }

  // Generate summary vertices for 'sum' submodules
  for (const sub of submodules) {
    if (!submoduleSumPaths.has(sub.path)) continue;
    
    const summary = summarizeSubmodule(normWorkspace, sub);
    const id = makeFileVertexId(sub.path);
    const fullPath = path.join(normWorkspace, sub.path);

    let fileHash = '';
    try {
      // Use the commit hash as the "hash" for submodule vertices
      fileHash = sub.commitHash ? sub.commitHash.substring(0, 16) : '';
    } catch {}

    vertices.push({
      id,
      relativePath: sub.path,
      absolutePath: fullPath,
      title: summary.title,
      content: summary.content,
      tags: summary.tags,
      imports: [],
      hash: fileHash
    });
  }

  return vertices;
}

function resolveSubmodulePolicy(
  subPath: string,
  policies?: Record<string, SubmodulePolicy> | SubmodulePolicy
): SubmodulePolicy {
  if (!policies) return 'sum'; // default
  if (typeof policies === 'string') return policies;
  return policies[subPath] || 'sum';
}

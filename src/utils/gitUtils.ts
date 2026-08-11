import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface SubmoduleInfo {
  path: string;        // Relative path within workspace
  url: string;         // Remote URL
  commitHash: string;  // Current checked-out commit (may be empty)
  initialized: boolean;
}

/**
 * Check if a directory is inside a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all non-ignored files in a git repository using `git ls-files`.
 * Returns relative paths from the workspace root.
 * Returns null if git is unavailable or directory is not a git repo.
 */
export function getGitTrackedFiles(workspaceDir: string): string[] | null {
  if (!isGitRepo(workspaceDir)) return null;

  try {
    // --cached: tracked files
    // --others: untracked files (new files not yet committed)
    // --exclude-standard: respect .gitignore, .git/info/exclude, global gitignore
    const output = execSync(
      'git ls-files --cached --others --exclude-standard',
      {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        maxBuffer: 50 * 1024 * 1024 // 50MB for large repos
      }
    );
    
    const files = output.toString('utf8')
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);
    
    return files;
  } catch {
    return null;
  }
}

/**
 * Detect git submodules in a workspace.
 * Returns empty array if no submodules or git is unavailable.
 */
export function getSubmodules(workspaceDir: string): SubmoduleInfo[] {
  if (!isGitRepo(workspaceDir)) return [];

  const submodules: SubmoduleInfo[] = [];

  // Parse .gitmodules for path and URL info
  const gitmodulesPath = path.join(workspaceDir, '.gitmodules');
  const pathUrlMap = new Map<string, string>();

  if (fs.existsSync(gitmodulesPath)) {
    try {
      const content = fs.readFileSync(gitmodulesPath, 'utf8');
      const lines = content.split('\n');
      let currentPath = '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        const pathMatch = trimmed.match(/^path\s*=\s*(.+)$/);
        const urlMatch = trimmed.match(/^url\s*=\s*(.+)$/);
        
        if (pathMatch) {
          currentPath = pathMatch[1].trim();
        }
        if (urlMatch && currentPath) {
          pathUrlMap.set(currentPath, urlMatch[1].trim());
        }
      }
    } catch {
      // .gitmodules exists but couldn't be parsed
    }
  }

  // Use `git submodule status` for actual state
  try {
    const output = execSync('git submodule status', {
      cwd: workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000
    });

    const lines = output.toString('utf8').split('\n').filter(l => l.trim().length > 0);
    
    for (const line of lines) {
      // Format: " <hash> <path> (<describe>)" or "-<hash> <path>" (not initialized)
      // Leading char: ' ' = initialized, '-' = not initialized, '+' = different commit
      const match = line.match(/^([- +])([0-9a-f]+)\s+(\S+)/);
      if (match) {
        const statusChar = match[1];
        const hash = match[2];
        const subPath = match[3];
        
        submodules.push({
          path: subPath,
          url: pathUrlMap.get(subPath) || '',
          commitHash: hash,
          initialized: statusChar !== '-'
        });
      }
    }
  } catch {
    // git submodule status failed — fall back to .gitmodules paths only
    for (const [subPath, url] of pathUrlMap) {
      const fullSubPath = path.join(workspaceDir, subPath);
      const hasGitDir = fs.existsSync(path.join(fullSubPath, '.git'));
      
      submodules.push({
        path: subPath,
        url,
        commitHash: '',
        initialized: hasGitDir
      });
    }
  }

  return submodules;
}

/**
 * Generate a summary codemap for a submodule treated as a single vertex ("sum up" mode).
 */
export function summarizeSubmodule(workspaceDir: string, sub: SubmoduleInfo): {
  title: string;
  content: string;
  tags: string[];
} {
  const fullPath = path.join(workspaceDir, sub.path);
  const dirName = path.basename(sub.path);

  let descSnippet = '';
  
  // Try to read package.json, Cargo.toml, pyproject.toml, or README for a description
  const readmeFiles = ['README.md', 'README.rst', 'README.txt', 'README'];
  for (const rf of readmeFiles) {
    const rfPath = path.join(fullPath, rf);
    if (fs.existsSync(rfPath)) {
      try {
        const content = fs.readFileSync(rfPath, 'utf8');
        // Grab first meaningful paragraph (skip title lines)
        const lines = content.split('\n');
        const textLines = lines.filter(l => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('='));
        if (textLines.length > 0) {
          descSnippet = textLines.slice(0, 3).join(' ').substring(0, 300);
        }
      } catch {}
      break;
    }
  }

  const pkgPath = path.join(fullPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.description) descSnippet = pkg.description;
    } catch {}
  }

  // List top-level entries for structure overview
  let topEntries: string[] = [];
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    topEntries = entries
      .filter(e => !e.name.startsWith('.'))
      .slice(0, 20)
      .map(e => e.isDirectory() ? `${e.name}/` : e.name);
  } catch {}

  const content = [
    `# Submodule: ${sub.path}`,
    `**URL**: \`${sub.url || 'unknown'}\``,
    `**Commit**: \`${sub.commitHash || 'unknown'}\``,
    `**Status**: ${sub.initialized ? 'Initialized' : 'Not initialized'}`,
    descSnippet ? `\n**Description**: ${descSnippet}` : '',
    topEntries.length > 0 ? `\n## Top-Level Structure\n${topEntries.map(e => `- \`${e}\``).join('\n')}` : ''
  ].filter(Boolean).join('\n');

  return {
    title: `[Submodule] ${sub.path}`,
    content,
    tags: ['submodule', 'codemap', 'codebase-graph']
  };
}

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

interface GitBranchCacheEntry {
  branch: string | null;
  ts: number;
}
const gitBranchCache = new Map<string, GitBranchCacheEntry>();
const GIT_BRANCH_CACHE_TTL_MS = 5000;

export function clearGitBranchCache(): void {
  gitBranchCache.clear();
}

/**
 * Get current git branch name fast. Returns null if detached HEAD or outside git.
 * Walks up directory hierarchy looking for .git (directory or worktree pointer file).
 */
export function getCurrentGitBranch(dir: string = process.cwd()): string | null {
  const resolvedDir = path.resolve(dir);

  // 1. Fast filesystem read of .git/HEAD (sub-millisecond, always fresh on branch switches)
  try {
    let curr = resolvedDir;
    while (curr) {
      const gitPath = path.join(curr, '.git');
      if (fs.existsSync(gitPath)) {
        let gitHeadPath: string | null = null;
        const stat = fs.statSync(gitPath);
        if (stat.isDirectory()) {
          gitHeadPath = path.join(gitPath, 'HEAD');
        } else if (stat.isFile()) {
          const line = fs.readFileSync(gitPath, 'utf8').trim();
          if (line.startsWith('gitdir:')) {
            const rawDir = line.slice(7).trim();
            const resolvedDirGit = path.isAbsolute(rawDir) ? rawDir : path.resolve(curr, rawDir);
            gitHeadPath = path.join(resolvedDirGit, 'HEAD');
          }
        }

        if (gitHeadPath && fs.existsSync(gitHeadPath)) {
          const content = fs.readFileSync(gitHeadPath, 'utf8').trim();
          const match = content.match(/^ref:\s*refs\/heads\/(.+)$/);
          if (match) {
            return match[1];
          }
        }
        // Found .git boundary but HEAD was detached or unreadable
        break;
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  } catch {}

  // 2. Fallback to cache for slow subprocess/CI checks
  const now = Date.now();
  const cached = gitBranchCache.get(resolvedDir);
  if (cached && (now - cached.ts < GIT_BRANCH_CACHE_TTL_MS)) {
    return cached.branch;
  }

  const setCache = (b: string | null): string | null => {
    if (gitBranchCache.size >= 100) gitBranchCache.clear();
    gitBranchCache.set(resolvedDir, { branch: b, ts: now });
    return b;
  };

  try {
    const branch = execSync('git symbolic-ref -q --short HEAD', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000
    }).toString('utf8').trim();
    if (branch && branch !== 'HEAD') {
      return setCache(branch);
    }
  } catch {}

  // CI/CD runner fallback: when running in detached HEAD (e.g. GitHub Actions, GitLab CI)
  const ciBranch = (
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.CI_COMMIT_REF_NAME ||
    process.env.CI_COMMIT_BRANCH ||
    process.env.GIT_BRANCH ||
    process.env.BRANCH_NAME ||
    process.env.STORMDRAIN_BRANCH
  )?.trim();
  if (ciBranch && ciBranch !== 'HEAD' && !ciBranch.startsWith('refs/tags/')) {
    const cleanCiBranch = ciBranch.replace(/^refs\/heads\//, '');
    return setCache(cleanCiBranch);
  }

  return setCache(null);
}

/**
 * Check if a branch has been merged into a target ref (default: HEAD) via:
 * 1. Direct git ancestry (git merge-base --is-ancestor)
 * 2. Remote tracking branch ancestry (origin/<branch>)
 * 3. Commit messages from PR squash-merges:
 *    - "Merge pull request #... from .../<branch>"
 *    - "Merge branch '<branch>' into ..."
 *    - "Merged in <branch> ..."
 */
export function isBranchMergedInto(
  branch: string,
  targetRef: string = 'HEAD',
  cwd: string = process.cwd()
): boolean {
  if (!branch || branch === 'main' || branch === 'master' || branch === 'HEAD') {
    return false;
  }
  if (!isGitRepo(cwd)) {
    return false;
  }

  // 1. Direct commit ancestry check: is <branch> an ancestor of targetRef?
  try {
    execSync(`git merge-base --is-ancestor ${JSON.stringify(branch)} ${JSON.stringify(targetRef)}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000
    });
    return true;
  } catch {}

  // 2. Check remote tracking branch origin/<branch> if local ref was deleted after PR
  try {
    execSync(`git merge-base --is-ancestor ${JSON.stringify(`origin/${branch}`)} ${JSON.stringify(targetRef)}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000
    });
    return true;
  } catch {}

  // 3. PR Squash / Merge Commit Message Matching in recent git log
  try {
    const logOutput = execSync(
      `git log -n 50 --format="%s%n%b%n---COMMIT_END---" ${JSON.stringify(targetRef)}`,
      {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000
      }
    ).toString('utf8');

    const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prPatterns = [
      new RegExp(`Merge pull request #\\d+ from (?:\\S+/)?${escapedBranch}\\b`, 'i'),
      new RegExp(`Merge branch '${escapedBranch}'`, 'i'),
      new RegExp(`Merged in ${escapedBranch}\\b`, 'i'),
      new RegExp(`\\bfrom branch ['"]?${escapedBranch}['"]?`, 'i'),
      new RegExp(`\\(${escapedBranch}\\)`, 'i')
    ];

    if (prPatterns.some(pat => pat.test(logOutput))) {
      return true;
    }
  } catch {}

  return false;
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

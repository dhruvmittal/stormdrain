import * as fs from 'fs';
import * as path from 'path';
import { getGitTrackedFiles } from './gitUtils';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.stormdrain', '.gemini', 'target', 'vendor', 'tmp'
]);

export function scanDirectoryTree(dir: string, depth = 0, maxDepth = 3, gitFiles?: Set<string>, rootDir?: string): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];
  const effectiveRoot = rootDir || dir;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') {
        if (entry.name === '.git' || entry.name === '.stormdrain') continue;
      }
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(effectiveRoot, fullPath);

      // If we have git-aware file list, skip entries that aren't tracked
      if (gitFiles && !entry.isDirectory()) {
        if (!gitFiles.has(relPath)) continue;
      }

      // For directories, check if any git-tracked file lives inside
      if (gitFiles && entry.isDirectory()) {
        const dirPrefix = relPath + '/';
        let hasTrackedChild = false;
        for (const gf of gitFiles) {
          if (gf.startsWith(dirPrefix)) {
            hasTrackedChild = true;
            break;
          }
        }
        if (!hasTrackedChild) continue;
      }

      const indent = '  '.repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${indent}- \`${entry.name}/\``);
        const subLines = scanDirectoryTree(fullPath, depth + 1, maxDepth, gitFiles, effectiveRoot);
        lines.push(...subLines);
      } else {
        lines.push(`${indent}- \`${entry.name}\``);
      }
    }
  } catch {
    // Ignore permissions / read errors
  }

  return lines;
}

export function generateCodebaseCodemap(workspaceDir: string): { title: string; content: string } {
  const normDir = path.resolve(workspaceDir);
  const folderName = path.basename(normDir);

  // Try git-aware file list for the tree
  let gitFilesSet: Set<string> | undefined;
  const gitFiles = getGitTrackedFiles(normDir);
  if (gitFiles) {
    gitFilesSet = new Set(gitFiles);
  }

  const tree = scanDirectoryTree(normDir, 0, 3, gitFilesSet, normDir);

  const keyFiles = ['package.json', 'README.md', 'Cargo.toml', 'pyproject.toml', 'flake.nix', 'tsconfig.json', 'go.mod', 'CMakeLists.txt']
    .filter(f => fs.existsSync(path.join(normDir, f)));

  let descSnippet = '';
  if (fs.existsSync(path.join(normDir, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(normDir, 'package.json'), 'utf8'));
      if (pkg.name || pkg.description) {
        descSnippet = `\n**Package**: \`${pkg.name || folderName}\` (v${pkg.version || '1.0.0'})\n` +
                      (pkg.description ? `**Description**: ${pkg.description}\n` : '');
      }
    } catch {}
  }

  const content = `# Codebase Map: ${folderName}\n` +
    `**Root Path**: \`${normDir}\`  \n` +
    `**Generated**: ${new Date().toISOString()}\n` +
    descSnippet + `\n` +
    (keyFiles.length > 0 ? `## Key Project Files\n${keyFiles.map(k => `- \`${k}\``).join('\n')}\n\n` : '') +
    `## Directory Structure Overview\n\n` +
    (tree.length > 0 ? tree.join('\n') : '- Empty directory');

  return {
    title: `[Codemap] Codebase Structure & File Map for ${folderName}`,
    content
  };
}

import * as fs from 'fs';
import * as path from 'path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.stormdrain', '.gemini', 'target', 'vendor', 'tmp'
]);

export function scanDirectoryTree(dir: string, depth = 0, maxDepth = 3): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];

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

      const indent = '  '.repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${indent}- \`${entry.name}/\``);
        const subLines = scanDirectoryTree(path.join(dir, entry.name), depth + 1, maxDepth);
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
  const tree = scanDirectoryTree(normDir, 0, 3);

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

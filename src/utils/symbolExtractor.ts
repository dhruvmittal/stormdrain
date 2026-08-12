import * as path from 'path';

export function extractSymbolOutline(filePath: string, content: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  const symbols: string[] = [];

  const lines = content.split(/\r?\n/);

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    for (const line of lines) {
      const trimmed = line.trim();
      // Match export statements
      const exportMatch = trimmed.match(/^export\s+(async\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z0-9_$]+)/);
      if (exportMatch) {
        const kind = exportMatch[2];
        const name = exportMatch[3];
        symbols.push(`export ${kind} ${name}`);
        continue;
      }
      // Match non-exported top-level classes and functions
      const topMatch = trimmed.match(/^(class|interface|type|enum)\s+([A-Za-z0-9_$]+)/);
      if (topMatch) {
        symbols.push(`${topMatch[1]} ${topMatch[2]}`);
      }
    }
  } else if (['.py'].includes(ext)) {
    for (const line of lines) {
      const trimmed = line.trim();
      const pyMatch = trimmed.match(/^(class|def)\s+([A-Za-z0-9_]+)/);
      if (pyMatch) {
        symbols.push(`${pyMatch[1]} ${pyMatch[2]}`);
      }
    }
  } else if (['.rs'].includes(ext)) {
    for (const line of lines) {
      const trimmed = line.trim();
      const rsMatch = trimmed.match(/^(pub\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
      if (rsMatch) {
        symbols.push(`${rsMatch[1] || ''}${rsMatch[2]} ${rsMatch[3]}`);
      }
    }
  } else if (['.go'].includes(ext)) {
    for (const line of lines) {
      const trimmed = line.trim();
      const goMatch = trimmed.match(/^func\s+(\([A-Za-z0-9_*\s]+\)\s+)?([A-Za-z0-9_]+)/);
      if (goMatch) {
        symbols.push(`func ${goMatch[2]}`);
      }
      const typeMatch = trimmed.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
      if (typeMatch) {
        symbols.push(`type ${typeMatch[1]} ${typeMatch[2]}`);
      }
    }
  }

  return symbols.slice(0, 30); // Cap at 30 top symbols for conciseness
}

import * as fs from 'fs';
import * as path from 'path';

export const STORMDRAIN_AGENT_SECTION = `## StormDrain Persistent Memory Protocol
This project uses StormDrain for persistent cross-session architectural memory via MCP tools (\`sd_*\`) or CLI (\`stormdrain <cmd>\`).

### Mandatory Sandboxing & Execution Rules:
1. **Strict Sandboxing (CRITICAL)**: NEVER directly access, inspect, or modify files inside the \`~/.stormdrain\` directory. The internal storage engine is managed exclusively by StormDrain.
2. **Authorized Execution (MCP or CLI)**: Always interact with StormDrain exclusively through official MCP server tools (\`sd_*\`) or the official \`stormdrain\` CLI. Never bypass these interfaces with raw SQLite queries or direct file edits to the storage repository.

### Workflow:
- **Primary Source Reader**: Use \`sd_read(path="...")\` or CLI \`stormdrain read <path>\` to inject topological invariants and caller constraints.
- **Pre-Edit Invariant Check**: Call \`sd_recall(target_file="...")\` or CLI \`stormdrain recall -t <path>\` before modifying code.
- **Record Discoveries**: Call \`sd_add(...)\` or CLI \`stormdrain add <type> <title> [content]\` on non-obvious invariants (canonical types: \`fact\`, \`decision\`, \`guide\`, \`warning\`, \`concept\`).
- **Harvest & Curate**: Run \`/sd_harvest\` (or \`stormdrain harvest\`) at session end; run \`/sd_curate\` (or \`stormdrain curate\`) to consolidate candidate micro-memories.

### Editorial Rule:
Record non-obvious invariants, architectural trade-offs, and critical gotchas; do NOT record routine implementation summaries or transient task progress.`;

export function scaffoldAgentsMd(
  targetDir: string,
  options?: { force?: boolean }
): { created: boolean; updated: boolean; filePath: string } {
  const filePath = path.join(targetDir, 'AGENTS.md');
  const force = !!options?.force;

  if (!fs.existsSync(filePath)) {
    const initialContent = `# Agent Guidelines & Project Context\n\n${STORMDRAIN_AGENT_SECTION}\n`;
    try {
      fs.writeFileSync(filePath, initialContent, 'utf8');
      return { created: true, updated: false, filePath };
    } catch {
      return { created: false, updated: false, filePath };
    }
  }

  try {
    const existing = fs.readFileSync(filePath, 'utf8');
    const lower = existing.toLowerCase();

    if (force) {
      // If force update is requested, replace existing StormDrain section if present or append
      const protocolHeaderRegex = /## StormDrain Persistent Memory(?: Protocol)?[\s\S]*?(?=(\n## [^\n]+)|$)/;
      let updatedContent = '';
      if (protocolHeaderRegex.test(existing)) {
        updatedContent = existing.replace(protocolHeaderRegex, STORMDRAIN_AGENT_SECTION.trimEnd());
      } else {
        updatedContent = `${existing.trimEnd()}\n\n${STORMDRAIN_AGENT_SECTION}\n`;
      }
      fs.writeFileSync(filePath, updatedContent.trimEnd() + '\n', 'utf8');
      return { created: false, updated: true, filePath };
    }

    // If not forcing, leave untouched if stormdrain tools or protocols are already mentioned
    if (
      lower.includes('stormdrain') ||
      lower.includes('storm drain') ||
      lower.includes('sd_read') ||
      lower.includes('sd_recall') ||
      lower.includes('sd_add') ||
      lower.includes('sd_scan') ||
      lower.includes('sd_consolidate')
    ) {
      return { created: false, updated: false, filePath };
    }

    const updatedContent = `${existing.trimEnd()}\n\n${STORMDRAIN_AGENT_SECTION}\n`;
    fs.writeFileSync(filePath, updatedContent, 'utf8');
    return { created: false, updated: true, filePath };
  } catch {
    return { created: false, updated: false, filePath };
  }
}

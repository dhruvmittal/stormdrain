import * as fs from 'fs';
import * as path from 'path';

export const STORMDRAIN_AGENT_SECTION = `## StormDrain Persistent Memory Protocol
This project uses StormDrain for persistent cross-session architectural memory. You have access to StormDrain MCP tools (\`sd_read\`, \`sd_recall\`, \`sd_add\`, \`sd_search\`, \`sd_get\`, \`sd_delete\`, \`sd_consolidate\`, \`sd_consolidation_candidates\`, \`sd_scan\`).

### Mandatory Sandboxing & MCP-First Rules:
1. **Strict Sandboxing (CRITICAL)**: NEVER directly access, inspect, or modify files inside the \`~/.stormdrain\` directory or the StormDrain internal source code. The internal storage engine (SQLite DBs, Git history, cache files) is managed exclusively by the StormDrain daemon.
2. **MCP-First Execution**: ALWAYS interact with StormDrain exclusively through the MCP server tools (\`sd_*\`). Do not attempt to bypass MCP tools by writing direct database queries or raw filesystem edits to the storage repository.

### Mandatory Workflow:
- **Primary Source Reader (MANDATORY)**: Always use \`sd_read(path="path/to/file")\` instead of default read tools. It automatically injects topological invariants, upstream caller constraints, and symbol outlines into the file stream.
- **Pre-Edit Invariant Check**: Call \`sd_recall(target_file="path/to/file")\` before modifying or refactoring any file to inspect multi-hop caller contracts and dependency rules.
- **Record High-Signal Discoveries**: Call \`sd_add(type, title, content, target_file)\` when discovering non-obvious bugs, architectural decisions, invariants, or reusable patterns.
- **Curate, Consolidate & Promote (\`/sd_curate\`)**: Run \`/sd_curate\` to review candidate micro-memories for surgical consolidation (\`sd_consolidate\`), generalize and promote environment-wide knowledge to global (\`sd_add(..., context="_global")\`), or connect related concepts (\`sd_relate\`).
- **Sync Code Graph**: Call \`sd_scan()\` whenever new source files, exports, or imports are added or reorganized.

### Memory Curation & Editorial Rubric:
- **High-Signal (DO RECORD)**: Non-obvious invariants, architectural decisions (ADRs/trade-offs), edge-case gotchas, failure modes, negative findings (disproven hypotheses), and performance thresholds.
- **Low-Signal (DO NOT RECORD)**: Routine implementation summaries, syntax notes, transient progress, or facts obvious from reading the code.
- **Tags**: Use semantic tags like \`#decision\`, \`#invariant\`, \`#hypothesis\`, \`#environment\`, \`#anti-pattern\`, and \`#performance\` for precise filtering.`;

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

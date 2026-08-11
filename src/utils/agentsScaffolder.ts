import * as fs from 'fs';
import * as path from 'path';

export const STORMDRAIN_AGENT_SECTION = `## StormDrain Persistent Memory Protocol
This project uses StormDrain for persistent cross-session architectural memory. You have access to StormDrain tools (\`sd_read\`, \`sd_recall\`, \`sd_add\`, \`sd_consolidate\`, \`sd_scan\`).

### Mandatory Workflow:
- **Primary Source Reader (MANDATORY)**: Always use \`sd_read(path="path/to/file")\` instead of default read tools. It automatically injects topological invariants, upstream caller constraints, and symbol outlines.
- **Pre-Edit Invariant Check**: Call \`sd_recall(target_file="path/to/file")\` before modifying or refactoring any file to inspect multi-hop caller contracts.
- **Record High-Signal Discoveries**: Call \`sd_add(type, title, content, target_file)\` when discovering non-obvious bugs, architectural decisions, invariants, or reusable patterns.
- **Consolidate Micro-Memories**: Call \`sd_consolidate(target_file="path/to/file")\` when a file vertex accumulates $\ge 3$ micro-memories to activate the Consolidation Shield.
- **Sync Code Graph**: Call \`sd_scan()\` whenever new source files or imports are added or reorganized.

### Memory Curation & Editorial Rubric:
- **High-Signal (DO RECORD)**: Non-obvious invariants, architectural decisions (ADRs/trade-offs), edge-case gotchas, failure modes, negative findings (disproven hypotheses), and performance thresholds.
- **Low-Signal (DO NOT RECORD)**: Routine implementation summaries, syntax notes, transient progress, or facts obvious from reading the code.
- **Tags**: Use semantic tags like \`#decision\`, \`#invariant\`, \`#hypothesis\`, \`#environment\`, \`#anti-pattern\`, and \`#performance\` for precise filtering.`;

export function scaffoldAgentsMd(targetDir: string): { created: boolean; updated: boolean; filePath: string } {
  const filePath = path.join(targetDir, 'AGENTS.md');

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
    
    // If the user has already mentioned stormdrain or any sd_* memory tools in any custom format, leave it untouched
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

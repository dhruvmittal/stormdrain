import { ContextManager } from '../core/context';
import { ConfigManager } from '../core/config';
import { getRecentGitActivity, isGitRepo } from './gitUtils';

export interface CuratePromptOptions {
  target?: string;
  threshold?: number;
  maxCandidates?: number;
}

export interface CuratePromptResult {
  title: string;
  description: string;
  promptText: string;
}

/**
 * Generate a structured curation prompt for an AI agent.
 * Handles both targeted curation (on a specific file or memory) and graph-wide sweep curation.
 */
export async function generateCuratePrompt(
  ctx: ContextManager,
  options?: CuratePromptOptions
): Promise<CuratePromptResult> {
  const target = options?.target?.trim();
  const threshold = options?.threshold && options.threshold > 0 ? options.threshold : 3;
  const maxCandidates = options?.maxCandidates || 10;
  const contextName = ctx.getContextName();

  if (target) {
    return generateTargetedCuratePrompt(ctx, target, threshold);
  } else {
    return generateGraphSweepCuratePrompt(ctx, threshold, maxCandidates);
  }
}

/**
 * Generate a focused curation prompt for a specific target node (file vertex or memory).
 */
function generateTargetedCuratePrompt(
  ctx: ContextManager,
  target: string,
  threshold: number
): CuratePromptResult {
  const node = ctx.getNodeDetails(target);
  const contextName = ctx.getContextName();

  if (!node) {
    const notFoundText = `# 🧹 StormDrain Memory Curation: Target "${target}"

Target node \`${target}\` was not found in context \`${contextName}\`.

### Suggested Actions:
1. Run \`sd_search(query="${target}")\` to find relevant memories or file paths.
2. Run \`sd_consolidation_candidates()\` to inspect available consolidation targets across the project.
`;
    return {
      title: `Curate Target: ${target}`,
      description: `Curation review for target ${target}`,
      promptText: notFoundText,
    };
  }

  let prompt = `# 🧹 StormDrain Knowledge Curation: Target "${target}"

You are conducting a focused architectural memory curation session on **\`${target}\`** in context **\`${contextName}\`**.

## 📌 Target Node Overview
- **Identifier**: \`${node.id}\`
- **Node Kind**: \`${(node.nodeType || 'memory').toUpperCase()}\`
- **Title**: ${node.title}
${node.type ? `- **Type**: \`${node.type}\`` : ''}
${node.tags && node.tags.length > 0 ? `- **Tags**: ${node.tags.map((t) => `\`${t}\``).join(', ')}` : ''}
${node.confidence !== undefined ? `- **Confidence**: ${(node.confidence * 100).toFixed(0)}%` : ''}

`;

  if (node.nodeType === 'codemap') {
    const attached = node.attachedMemories || [];
    prompt += `## 📑 Attached Micro-Memories (${attached.length} total)
`;
    if (attached.length === 0) {
      prompt += `*No domain micro-memories currently attached to this file vertex.*\n\n`;
    } else {
      attached.forEach((m, idx) => {
        prompt += `${idx + 1}. **[${(m.type || 'memory').toUpperCase()}]** ${m.title} (\`${m.id}\`, confidence: ${(m.confidence * 100).toFixed(0)}%)\n`;
      });
      prompt += '\n';
    }

    if (node.astOutline && node.astOutline.length > 0) {
      prompt += `## 🧬 Exported AST Symbols
${node.astOutline.map(s => `- \`${s}\``).slice(0, 10).join('\n')}${node.astOutline.length > 10 ? `\n- *...and ${node.astOutline.length - 10} more symbols*` : ''}\n\n`;
    }
  } else {
    if (node.content) {
      prompt += `## 📄 Memory Content
\`\`\`markdown
${node.content}
\`\`\`

`;
    }
    const outgoing = node.outgoingRelations || [];
    const incoming = node.incomingRelations || [];
    prompt += `## 🔗 Connected Graph Relations
- **Outgoing Links (${outgoing.length})**: ${outgoing.length === 0 ? 'None' : outgoing.map(r => `\`${r.type}\` ➔ ${r.title || r.target} (\`${r.target}\`)`).join(', ')}
- **Incoming References (${incoming.length})**: ${incoming.length === 0 ? 'None' : incoming.map(r => `${r.title || r.source} (\`${r.source}\`) ➔ \`${r.type}\``).join(', ')}

`;
  }

  prompt += `## 🎯 Actionable Curation Protocol

Review the data above and perform the necessary maintenance actions:

### 1. Consolidate Micro-Memories (if $\\ge ${threshold}$ micro-memories attached)
- If multiple related micro-memories exist, synthesize them into a coherent architectural guide.
- Select the relevant memory IDs to merge and call:
  \`sd_consolidate(target_file="${target}", memory_ids=[...])\`
- *Note*: If unlike/unrelated facts are attached, exclude their IDs so they remain active.

### 2. Generalize & Promote Universal Knowledge to \`_global\`
- If any memory captures universal toolchain rules, compiler settings, OS quirks, or framework patterns independent of this project:
  1. Abstract away local file paths and repo-specific identifiers.
  2. Call \`sd_add(type=..., title=..., content=..., context="_global", tags=[...])\`.
  3. If the local copy is now redundant, delete it via \`sd_delete(id="...")\`.

### 3. Connect Missing Relational Links
- If this node is logically related to or depends on other concepts or files, link them:
  \`sd_relate(source_id="${node.id}", target="<other_target>", type="related_to")\`

### 4. Prune Noise or Stale Memories
- If any attached memory contains obsolete or low-signal progress noise, delete it:
  \`sd_delete(id="<memory_id>")\`
`;

  return {
    title: `Curate Target: ${target}`,
    description: `Focused curation review for ${target} in ${contextName}`,
    promptText: prompt,
  };
}

/**
 * Generate a graph-wide sweep curation prompt.
 */
function generateGraphSweepCuratePrompt(
  ctx: ContextManager,
  threshold: number,
  maxCandidates: number
): CuratePromptResult {
  const contextName = ctx.getContextName();
  const candidates = ctx.findConsolidationCandidates(threshold).slice(0, maxCandidates);
  const allMemories = ctx.listMemories();

  // Find unpromoted branch memories
  let unpromotedBranches: { git_branch: string; count: number }[] = [];
  try {
    const rows = ctx.getDb().prepare(`
      SELECT git_branch, COUNT(*) as count 
      FROM memories 
      WHERE (is_canonical = 0 OR is_canonical IS NULL) AND git_branch IS NOT NULL AND git_branch != ''
      GROUP BY git_branch
      ORDER BY count DESC
    `).all() as { git_branch: string; count: number }[];
    unpromotedBranches = rows;
  } catch {
    // If column doesn't exist yet or db error
  }

  // Find candidate memories for promotion: facts or environment-tagged memories in local context
  const promotionCandidates = allMemories.filter((m) => {
    if (m.metadata.type === 'guide') return false;
    const lowerTitle = (m.metadata.title || '').toLowerCase();
    const hasEnvTag = (m.metadata.tags || []).some((t) => 
      t.includes('env') || t.includes('nix') || t.includes('os') || t.includes('tool') || t.includes('compiler') || t.includes('global')
    );
    const hasEnvKeywords = 
      lowerTitle.includes('nixos') || 
      lowerTitle.includes('gcc') || 
      lowerTitle.includes('clang') || 
      lowerTitle.includes('linux') || 
      lowerTitle.includes('git') ||
      lowerTitle.includes('toolchain');
    return hasEnvTag || (m.metadata.type === 'fact' && hasEnvKeywords);
  }).slice(0, 5);

  // Find orphan memories: memories with no targets and no outgoing relations
  const orphanCandidates = allMemories.filter((m) => {
    if (m.metadata.type === 'guide') return false;
    const hasRelations = m.metadata.relations && m.metadata.relations.length > 0;
    return !hasRelations;
  }).slice(0, 5);

  let prompt = `# 🧹 StormDrain Graph-Wide Curation Sweep

You are performing a holistic health and curation review of the knowledge graph in context **\`${contextName}\`** (${allMemories.length} total memories).

---

## 1. 🏗️ Consolidation Candidates ($\\ge ${threshold}$ Micro-Memories)
`;

  if (candidates.length === 0) {
    prompt += `*No dense micro-memory clusters exceeding threshold (${threshold}) found. Graph is well-consolidated.*\n\n`;
  } else {
    prompt += `The following targets have accumulated multiple micro-memories ready for synthesis:\n\n`;
    candidates.forEach((c, idx) => {
      const displayTarget = c.targetTitle || c.target;
      prompt += `### ${idx + 1}. \`${displayTarget}\` (${c.memoryCount} micro-memories, kind: ${c.targetType})\n`;
      c.memories.forEach((m) => {
        prompt += `- **[${m.type.toUpperCase()}]** ${m.title} (\`${m.id}\`, confidence: ${(m.confidence * 100).toFixed(0)}%)\n`;
      });
      prompt += `👉 **Action**: Call \`sd_consolidate(target_file="${displayTarget}", memory_ids=[${c.memories.map(m => `"${m.id}"`).join(', ')}])\` to synthesize into a guide and activate the Consolidation Shield.\n\n`;
    });
  }

  prompt += `---

## 2. 🌐 Promotion Candidates (Local ➔ \`_global\`)
`;

  if (promotionCandidates.length === 0) {
    prompt += `*No obvious environment-wide facts detected in local context.*\n\n`;
  } else {
    prompt += `The following local memories appear to contain universal toolchain, OS, or environment rules that may benefit all projects:\n\n`;
    promotionCandidates.forEach((m, idx) => {
      prompt += `${idx + 1}. **[${m.metadata.type.toUpperCase()}]** ${m.metadata.title} (\`${m.metadata.id}\`)\n`;
      if (m.metadata.tags && m.metadata.tags.length > 0) prompt += `   Tags: ${m.metadata.tags.join(', ')}\n`;
      const preview = (m.content || '').split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
      prompt += `   *Preview*: ${preview.substring(0, 120)}...\n`;
      prompt += `   👉 **Action**: Inspect with \`sd_get(id="${m.metadata.id}")\`, abstract project-specific details, and call \`sd_add(type="${m.metadata.type}", title="${m.metadata.title}", content="<generalized>", context="_global")\`.\n\n`;
    });
  }

  prompt += `---

## 3. 🧩 Orphan & Disconnected Memories
`;

  if (orphanCandidates.length === 0) {
    prompt += `*All memories are linked to target files or connected concepts in the DAG.*\n\n`;
  } else {
    prompt += `The following memories have no target files or relation links attached:\n\n`;
    orphanCandidates.forEach((m, idx) => {
      prompt += `${idx + 1}. **[${m.metadata.type.toUpperCase()}]** ${m.metadata.title} (\`${m.metadata.id}\`)\n`;
      prompt += `   👉 **Action**: Link to relevant file or memory using \`sd_relate(source_id="${m.metadata.id}", target="<file_or_memory_id>", type="applies_to")\` or prune if obsolete with \`sd_delete(id="${m.metadata.id}")\`.\n\n`;
    });
  }

  prompt += `---

## 4. 🌿 Unpromoted Branch Memories
`;

  if (unpromotedBranches.length === 0) {
    prompt += `*No unpromoted branch memories found. All branch knowledge is canonical or on baseline branches.*\n\n`;
  } else {
    prompt += `The following feature branches have accumulated non-canonical memories:\n\n`;
    unpromotedBranches.forEach((b) => {
      prompt += `- **Branch \`${b.git_branch}\`**: ${b.count} unpromoted memories\n`;
      prompt += `  - Inspect: \`sd_search(query="", branch="${b.git_branch}", unpromoted_only=true)\`\n`;
      prompt += `  - Promote single: \`sd_update(id="<id>", is_canonical=true)\`\n`;
      prompt += `  - Promote all on branch: run CLI \`stormdrain branch promote ${b.git_branch}\`\n\n`;
    });
  }

  prompt += `---

## 🛠️ Step-by-Step Curation Workflow
1. **Consolidate**: Work through the dense clusters in Section 1 to synthesize guides and reduce prompt bloat.
2. **Promote Universal**: Generalize universal facts in Section 2 and add them to \`_global\`.
3. **Promote Branch Memories**: Review merged feature branch memories in Section 4 and promote to canonical baseline with \`sd_update(id="...", is_canonical=true)\` or CLI.
4. **Link / Prune**: Connect orphans in Section 3 to relevant files or delete outdated notes.
5. **Verify**: Call \`sd_recall()\` or \`sd_search(query="...")\` to ensure clean recall precision.
`;

  return {
    title: `Graph Curation Sweep (${contextName})`,
    description: `Holistic graph curation sweep for context ${contextName}`,
    promptText: prompt,
  };
}

export interface HarvestPromptOptions {
  limit?: number;
  workspaceDir?: string;
}

export interface HarvestPromptResult {
  title: string;
  description: string;
  promptText: string;
}

/**
 * Generate a structured discovery harvest prompt for an AI agent or developer.
 * Inspects recent git commits and modified files, cross-references existing memories,
 * and prompts for high-signal discoveries (warning, fact, lesson, pattern, sequence, guide).
 */
export async function generateHarvestPrompt(
  ctx: ContextManager,
  options?: HarvestPromptOptions
): Promise<HarvestPromptResult> {
  const limit = options?.limit && options.limit > 0 ? options.limit : 5;
  let workspaceDir = options?.workspaceDir;
  if (!workspaceDir) {
    if (isGitRepo(process.cwd())) {
      workspaceDir = process.cwd();
    } else {
      try {
        const cm = new ConfigManager();
        const ctxData = cm.getContext(ctx.getContextName());
        const found = (ctxData?.paths || []).find(p => isGitRepo(p));
        workspaceDir = found || process.cwd();
      } catch {
        workspaceDir = process.cwd();
      }
    }
  }
  const contextName = ctx.getContextName();

  const activity = getRecentGitActivity(workspaceDir, limit);
  const activeBranch = activity.branch || 'unknown';

  // Find existing memories attached to the touched files
  const existingMemoriesByFile: Array<{ file: string; id: string; type: string; title: string }> = [];

  if (activity.touchedFiles.length > 0) {
    // Collect target vertex IDs
    const fileVertexMap = new Map<string, string>(); // vertexId -> relFile
    for (const file of activity.touchedFiles) {
      const vId = ctx.resolveTargetId(file);
      if (vId) fileVertexMap.set(vId, file);
    }

    const vertexIds = Array.from(fileVertexMap.keys());
    if (vertexIds.length > 0) {
      try {
        const placeholders = vertexIds.map(() => '?').join(',');
        const rows = ctx.getDb().prepare(`
          SELECT DISTINCT m.id, m.type, m.title, r.target_id
          FROM relations r
          JOIN memories m ON m.id = r.source_id
          WHERE r.target_id IN (${placeholders})
          ORDER BY m.id DESC
        `).all(...vertexIds) as Array<{ id: string; type: string; title: string; target_id: string }>;

        for (const row of rows) {
          const matchedFile = fileVertexMap.get(row.target_id) || row.target_id;
          existingMemoriesByFile.push({
            file: matchedFile,
            id: row.id,
            type: row.type,
            title: row.title
          });
        }
      } catch {}
    }
  }

  let prompt = `# 🌾 StormDrain Discovery Harvest

You are wrapping up development on branch **\`${activeBranch}\`** in context **\`${contextName}\`**.
Your goal is to extract and persist discoveries made during this session into StormDrain so future agents and sessions have immediate access to them.

---

## 🔍 Recent Session Context
- **Active Branch**: \`${activeBranch}\`
- **Recent Commits**:
`;

  if (activity.recentCommits.length === 0) {
    prompt += `*No recent commits found on active branch.*\n`;
  } else {
    for (const c of activity.recentCommits) {
      prompt += `- \`${c.hash}\` ${c.subject}\n`;
    }
  }

  prompt += `\n- **Modified / Touched Files**:\n`;
  if (activity.touchedFiles.length === 0) {
    prompt += `*No recently modified files detected in working tree or recent commits.*\n`;
  } else {
    const displayFiles = activity.touchedFiles.slice(0, 20);
    for (const f of displayFiles) {
      prompt += `- \`${f}\`\n`;
    }
    if (activity.touchedFiles.length > 20) {
      prompt += `- *...and ${activity.touchedFiles.length - 20} more files*\n`;
    }
  }

  prompt += `\n### 📚 Existing Memories on Touched Files (Avoid Duplicating These)\n`;
  if (existingMemoriesByFile.length === 0) {
    prompt += `*No memories currently recorded for recently touched files.*\n`;
  } else {
    for (const m of existingMemoriesByFile.slice(0, 15)) {
      prompt += `- \`${m.id}\` [${m.type.toUpperCase()}]: *${m.title}* (\`${m.file}\`)\n`;
    }
    if (existingMemoriesByFile.length > 15) {
      prompt += `- *...and ${existingMemoriesByFile.length - 15} more memories*\n`;
    }
  }

  prompt += `\n---

## 🎯 Discovery Extraction Rubric
Review what you learned while implementing and debugging this session.
Do NOT review code quality or audit PRs. Capture **concrete discoveries already made**:

| Memory Type | Core Question to Ask | Example Discovery |
| :--- | :--- | :--- |
| **\`warning\`** | *What footgun, subtle hazard, or anti-pattern must future sessions avoid?* | *"Do not use \`git branch --merged\` for squash merges; squash merges produce new commit hashes."* |
| **\`fact\`** | *What hard structural invariant or caller contract did you establish or uncover?* | *"Memories on feature branches must have \`is_canonical == 1\` to cross into \`main\`."* |
| **\`lesson\`** | *What tricky bug or unexpected failure mode did you diagnose and solve?* | *"In NixOS, Vitest subprocesses need \`nix develop --command\` to link shared libraries."* |
| **\`pattern\`** | *What reusable structural pattern or convention was adopted in this codebase?* | *"Use parent directory walking to find Git root instead of spawning shell subprocesses."* |
| **\`sequence\`** | *What strict ordering of steps or lifecycle protocol is required here?* | *"Promotion order: 1. Check reachability, 2. Execute SQL update, 3. Invalidate memory cache."* |
| **\`guide\`** | *What end-to-end procedural workflow or subsystem rule was formulated?* | *"Guide on testing git branch provenance across mock git worktrees."* |

*(Note: High-level architectural \`concept\` nodes and AST \`codemap\` files are managed separately; do not create them during this harvest.)*

---

## 🏷️ Standard Tags
Use semantic tags for precise multi-hop filtering:
\`#invariant\`, \`#decision\`, \`#edge-case\`, \`#environment\`, \`#performance\`, \`#anti-pattern\`, \`#toolchain\`

---

## ⚡ Action Directive
For any genuine discovery not already recorded above, immediately call \`sd_add()\` to persist it:

\`\`\`json
sd_add({
  "type": "warning" | "fact" | "lesson" | "pattern" | "sequence" | "guide",
  "title": "<Concise summary>",
  "content": "<Detailed mechanism, rationale, or reproduction>",
  "target_file": "<path/to/primary/file>",
  "tags": ["#tag1", "#tag2"]
})
\`\`\`
`;

  return {
    title: `Discovery Harvest: ${activeBranch} (${contextName})`,
    description: `Extract and persist architectural discoveries from recent work on ${activeBranch}`,
    promptText: prompt,
  };
}

import { ContextManager } from '../core/context';

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

## 🛠️ Step-by-Step Curation Workflow
1. **Consolidate**: Work through the dense clusters in Section 1 to synthesize guides and reduce prompt bloat.
2. **Promote**: Generalize universal facts in Section 2 and add them to \`_global\`.
3. **Link / Prune**: Connect orphans in Section 3 to relevant files or delete outdated notes.
4. **Verify**: Call \`sd_recall()\` or \`sd_search(query="...")\` to ensure clean recall precision.
`;

  return {
    title: `Graph Curation Sweep (${contextName})`,
    description: `Holistic graph curation sweep for context ${contextName}`,
    promptText: prompt,
  };
}

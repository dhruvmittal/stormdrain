import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { FileReader } from '../core/reader';
import { MemoryType, RelationType, USER_CREATABLE_TYPES } from '../types';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';
import { generateCuratePrompt, generateHarvestPrompt } from '../utils/promptTemplates';

export class StormDrainMcpServer {
  private server: Server;
  private config: ConfigManager;
  private reader: FileReader;
  private contextCache: Map<string, ContextManager> = new Map();

  private sessionWorkspaceDir?: string;
  private readonly MUTATING_TOOLS = new Set([
    'sd_add',
    'sd_update',
    'sd_relate',
    'sd_delete',
    'sd_consolidate',
    'sd_scan',
    'sd_prune'
  ]);

  constructor(workspaceDirectory?: string) {
    this.config = new ConfigManager();
    this.reader = new FileReader(this.config);

    if (workspaceDirectory) {
      this.sessionWorkspaceDir = path.resolve(workspaceDirectory);
    } else if (!ConfigManager.isSystemOrHomeRoot(process.cwd())) {
      this.sessionWorkspaceDir = path.resolve(process.cwd());
    }
    
    this.server = new Server(
      {
        name: 'stormdrain',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
  }

  private getOrCreateContext(targetContext: string): { ctx: ContextManager; targetContext: string } {
    let ctx = this.contextCache.get(targetContext);
    if (!ctx) {
      ctx = new ContextManager(targetContext);
      this.contextCache.set(targetContext, ctx);
    }
    return { ctx, targetContext };
  }

  public getContext(explicitContext?: string): { ctx: ContextManager; targetContext: string } {
    const ws = this.sessionWorkspaceDir || process.cwd();
    const targetContext = this.config.resolveContext(explicitContext, ws);
    return this.getOrCreateContext(targetContext);
  }

  private getContextForRequest(request: any): { ctx: ContextManager; targetContext: string } {
    const toolName = request?.params?.name;
    const args = request?.params?.arguments || {};
    let isMutating = this.MUTATING_TOOLS.has(toolName);
    if (toolName === 'sd_memory') {
      const action = args.action;
      isMutating = action === 'add' || action === 'delete' || action === 'consolidate';
    }

    // Tier 0: Explicit context argument
    const explicitContext = (args.context || args.contextName) as string | undefined;
    if (explicitContext) {
      const resolvedExplicit = explicitContext === 'global' ? '_global' : explicitContext;
      if (this.config.getContext(resolvedExplicit)) {
        return this.getOrCreateContext(resolvedExplicit);
      }
    }

    // Tier 1: Target path candidate introspection
    const candidatePaths: string[] = [];
    const collectCandidate = (val: any) => {
      if (typeof val === 'string' && val.trim() && !val.trim().startsWith('mem_')) {
        candidatePaths.push(val.trim());
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.trim() && !item.trim().startsWith('mem_')) {
            candidatePaths.push(item.trim());
          }
        }
      }
    };

    collectCandidate(args.path);
    collectCandidate(args.filePath);
    collectCandidate(args.target_file);
    collectCandidate(args.directory);
    collectCandidate(args.target);
    collectCandidate(args.targets);
    collectCandidate(args.add_targets);

    const baseDir = this.sessionWorkspaceDir || (!ConfigManager.isSystemOrHomeRoot(process.cwd()) ? process.cwd() : undefined);

    for (const p of candidatePaths) {
      if (path.isAbsolute(p)) {
        const matched = this.config.resolveContextByCwd(p);
        if (matched) return this.getOrCreateContext(matched);
      } else {
        if (baseDir) {
          const abs = path.resolve(baseDir, p);
          const matched = this.config.resolveContextByCwd(abs);
          if (matched) return this.getOrCreateContext(matched);
        }
        for (const ctxCfg of Object.values(this.config.getContexts())) {
          for (const root of ctxCfg.paths || []) {
            try {
              if (fs.existsSync(path.resolve(root, p))) {
                return this.getOrCreateContext(ctxCfg.name);
              }
            } catch {}
          }
        }
      }
    }

    // Tier 1b: Memory ID introspection (for sd_get, sd_update, sd_delete, sd_relate)
    const candidateMemIds: string[] = [];
    const collectMemId = (val: any) => {
      if (typeof val === 'string' && val.trim().startsWith('mem_')) {
        candidateMemIds.push(val.trim());
      }
    };
    collectMemId(args.id);
    collectMemId(args.source_id);
    collectMemId(args.target);

    if (candidateMemIds.length > 0) {
      if (baseDir) {
        const sessionCtxName = this.config.resolveContextByCwd(baseDir);
        if (sessionCtxName) {
          const { ctx: sCtx } = this.getOrCreateContext(sessionCtxName);
          for (const mid of candidateMemIds) {
            try {
              const row = sCtx.getDb().prepare('SELECT 1 FROM memories WHERE id = ?').get(mid);
              if (row) return this.getOrCreateContext(sessionCtxName);
            } catch {}
          }
        }
      }
      for (const ctxCfg of Object.values(this.config.getContexts())) {
        try {
          const { ctx: pCtx } = this.getOrCreateContext(ctxCfg.name);
          for (const mid of candidateMemIds) {
            const row = pCtx.getDb().prepare('SELECT 1 FROM memories WHERE id = ?').get(mid);
            if (row) return this.getOrCreateContext(ctxCfg.name);
          }
        } catch {}
      }
    }

    // Tier 2: Session workspace matching
    if (baseDir) {
      const matched = this.config.resolveContextByCwd(baseDir);
      if (matched) return this.getOrCreateContext(matched);
    }

    // Tier 3: Fail-closed on mutating operations if project contexts exist, safe fallback to _global on read queries
    if (isMutating) {
      const nonGlobalContexts = Object.keys(this.config.getContexts()).filter(k => k !== '_global' && k !== 'global');
      if (nonGlobalContexts.length > 0) {
        throw new Error(`Cannot perform mutating operation "${toolName}": workspace path does not belong to any registered StormDrain context. Please provide explicit "context" parameter or initialize with sd_init.`);
      }
    }

    return this.getOrCreateContext('_global');
  }

  public async close(): Promise<void> {
    for (const ctx of this.contextCache.values()) {
      await ctx.close();
    }
    this.contextCache.clear();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const { ctx } = this.getContext();
      const settings = this.config.getSettings();
      
      let injectedMemory = 'No top memories found.';
      const topMemories = ctx.recallTopMemories(5) as Array<{ type: string; title: string; id: string; content_snippet?: string }>;
      if (topMemories.length > 0) {
        injectedMemory = topMemories.map((m) => 
          `- [${m.type.toUpperCase()}] ${m.title} (ID: ${m.id})\n  ${m.content_snippet ? m.content_snippet.substring(0, 100) : ''}...`
        ).join('\n\n');
      }

      const contextProp = {
        type: 'string',
        description: 'Optional target context namespace override (e.g. "_global" or "global" for cross-project shared knowledge, or specific project context name). Defaults to auto-resolved workspace context.'
      };

      const targetFileProp = {
        type: 'string',
        description: 'Optional file path (e.g. src/core/config.ts) to pull connected DAG subgraph memories'
      };

      const tools: any[] = [];

      // Optional Super-Reader Tool (sd_read)
      if (settings.readTool.enabled) {
        const readDesc = settings.readTool.highlightAsPrimary
          ? `PRIMARY FILE READER: Read source file contents with automatic topological invariant injection, AST symbol outlines, upstream caller constraints, and downstream contracts. Always use this tool instead of standard file viewing tools to ensure you do not violate architectural contracts.`
          : `FILE READER WITH INVARIANTS: Read source file contents with topological memory injection, AST symbol outlines, upstream caller constraints, and downstream contracts.`;

        tools.push({
          name: 'sd_read',
          description: readDesc,
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to file to view/read. Can be relative to workspace or absolute.'
              },
              start_line: {
                type: 'number',
                description: 'Optional start line number (1-indexed)'
              },
              end_line: {
                type: 'number',
                description: 'Optional end line number (1-indexed)'
              },
              offset: {
                type: 'number',
                description: 'Optional start line offset (alias for start_line)'
              },
              limit: {
                type: 'number',
                description: 'Optional line count limit'
              },
              include_invariants: {
                type: 'boolean',
                description: 'Whether to inject architectural invariants and upstream caller constraints (default true)'
              },
              include_symbols: {
                type: 'boolean',
                description: 'Whether to extract and prepend AST exported symbols (classes, functions, interfaces)'
              },
              context: contextProp
            },
            required: ['path']
          }
        });
      }

      tools.push(
        {
          name: 'sd_recall',
          description: `MANDATORY PRE-ACTION TOOL: Always call this tool with 'target_file' before modifying, refactoring, or investigating any file. It retrieves essential architectural invariants, upstream caller constraints (to prevent breaking changes), and downstream dependency rules via multi-hop topological PageRank.\n\n### Top Injected Memories ###\n${injectedMemory}`,
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of memories to recall (default 10)'
              },
              target_file: targetFileProp,
              context: contextProp
            }
          }
        },
        {
          name: 'sd_memory',
          description: 'Manage memories in the knowledge graph: add invariants/decisions, search memories, inspect nodes, delete memories, or consolidate micro-memories.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['add', 'search', 'get', 'delete', 'consolidate'],
                description: 'The memory operation to execute: "add" to record knowledge, "search" to query, "get" to inspect full details, "delete" to remove, "consolidate" to merge micro-memories.'
              },
              type: {
                type: 'string',
                enum: USER_CREATABLE_TYPES,
                description: 'Memory type for "add" action: fact, decision, guide, warning, concept'
              },
              title: {
                type: 'string',
                description: 'Title of the memory for "add" action'
              },
              content: {
                type: 'string',
                description: 'Markdown content for "add" action'
              },
              target: {
                type: 'string',
                description: 'Target file path or memory ID to link (for "add") or consolidate (for "consolidate")'
              },
              relation_type: {
                type: 'string',
                description: 'Relation type for "add" action linking to target (e.g. affects, supports, related_to)'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Categorization tags for "add" action'
              },
              query: {
                type: 'string',
                description: 'Search query for "search" action'
              },
              id: {
                type: 'string',
                description: 'Memory ID (e.g. mem_123456) or file path for "get" or "delete" action'
              },
              memory_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific memory IDs to merge for "consolidate" action (optional)'
              },
              context: contextProp
            },
            required: ['action']
          }
        }
      );

      return { tools };
    });



    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { ctx, targetContext } = this.getContextForRequest(request);

        if (request.params.name === 'sd_memory') {
          const mArgs = (request.params.arguments || {}) as any;
          const action = mArgs.action;
          if (!action) {
            return {
              content: [{ type: 'text', text: 'Validation Error: "action" parameter is required for sd_memory ("add", "search", "get", "delete", "consolidate").' }],
              isError: true
            };
          }

          if (action === 'add') {
            if (!mArgs.title || !mArgs.content) {
              return {
                content: [{ type: 'text', text: 'Validation Error: "title" and "content" are required for action "add".' }],
                isError: true
              };
            }
            request.params.name = 'sd_add';
            mArgs.target_file = mArgs.target || mArgs.target_file;
            mArgs.relation_type = mArgs.relation_type || mArgs.relationType;
          } else if (action === 'search') {
            if (mArgs.query === undefined) {
              return {
                content: [{ type: 'text', text: 'Validation Error: "query" is required for action "search".' }],
                isError: true
              };
            }
            request.params.name = 'sd_search';
          } else if (action === 'get') {
            const id = mArgs.id || mArgs.target;
            if (!id) {
              return {
                content: [{ type: 'text', text: 'Validation Error: "id" or "target" is required for action "get".' }],
                isError: true
              };
            }
            request.params.name = 'sd_get';
            mArgs.id = id;
          } else if (action === 'delete') {
            if (!mArgs.id) {
              return {
                content: [{ type: 'text', text: 'Validation Error: "id" is required for action "delete".' }],
                isError: true
              };
            }
            request.params.name = 'sd_delete';
          } else if (action === 'consolidate') {
            const target = mArgs.target || mArgs.target_file;
            if (!target) {
              return {
                content: [{ type: 'text', text: 'Validation Error: "target" is required for action "consolidate".' }],
                isError: true
              };
            }
            request.params.name = 'sd_consolidate';
            mArgs.target_file = target;
          } else {
            return {
              content: [{ type: 'text', text: `Unknown action "${action}" for sd_memory. Supported actions: add, search, get, delete, consolidate.` }],
              isError: true
            };
          }
        }

        if (request.params.name === 'sd_read') {
          const args = request.params.arguments as {
            path?: string;
            filePath?: string;
            start_line?: number;
            startLine?: number;
            end_line?: number;
            endLine?: number;
            offset?: number;
            limit?: number;
            include_invariants?: boolean;
            includeInvariants?: boolean;
            include_symbols?: boolean;
            includeSymbols?: boolean;
            context?: string;
          };

          const targetPath = args.path || args.filePath;
          if (!targetPath) {
            throw new Error('Argument "path" is required for sd_read.');
          }

          let startLine = args.start_line !== undefined ? args.start_line : args.startLine;
          let endLine = args.end_line !== undefined ? args.end_line : args.endLine;
          if (startLine === undefined && args.offset !== undefined) {
            startLine = Math.max(1, args.offset);
          }
          if (endLine === undefined && args.limit !== undefined && startLine !== undefined) {
            endLine = startLine + args.limit - 1;
          }
          const includeInvariants = args.include_invariants !== undefined ? args.include_invariants : args.includeInvariants;
          const includeSymbols = args.include_symbols !== undefined ? args.include_symbols : args.includeSymbols;

          const ctxCfg = this.config.getContext(targetContext);
          const contextRoot = (ctxCfg?.paths && ctxCfg.paths.length > 0)
            ? ctxCfg.paths[0]
            : (this.sessionWorkspaceDir || process.cwd());

          const result = await this.reader.readFile({
            filePath: targetPath,
            startLine,
            endLine,
            includeInvariants,
            includeSymbols,
            context: targetContext,
            cwd: contextRoot
          });

          return {
            content: [{ type: 'text', text: result.content }]
          };
        }

        if (request.params.name === 'sd_recall') {
          const limit = (request.params.arguments?.limit as number) || 10;
          const targetFile = request.params.arguments?.target_file as string | undefined;


          if (targetFile) {
            const multiHop = ctx.recallMultiHop(targetFile, { maxDepth: 3, maxResults: limit, cumulativeThreshold: 0.98 });
            
            if (multiHop.all.length === 0) {
              return { content: [{ type: 'text', text: `No memories found for target file "${targetFile}" or its topological neighborhood.` }] };
            }

            const sections: string[] = [];

            if (multiHop.direct.length > 0) {
              sections.push(`### 🎯 Direct File Invariants (${targetFile})`);
              for (const r of multiHop.direct) {
                const mem = ctx.getMemory(r.id);
                sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
              }
            }

            if (multiHop.upstream.length > 0) {
              sections.push(`### ⚠️ Upstream Consumer Constraints (Callers at Risk)`);
              for (const r of multiHop.upstream) {
                const mem = ctx.getMemory(r.id);
                const fileLabel = r.targetFile ? ` [via ${r.targetFile}, Hop ${r.depth}]` : '';
                sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`${fileLabel}, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
              }
            }

            if (multiHop.downstream.length > 0) {
              sections.push(`### 📦 Downstream Dependency Invariants (Foundations)`);
              for (const r of multiHop.downstream) {
                const mem = ctx.getMemory(r.id);
                const fileLabel = r.targetFile ? ` [via ${r.targetFile}, Hop ${r.depth}]` : '';
                sections.push(`- **[${r.type.toUpperCase()}] ${r.title}** (ID: \`${r.id}\`${fileLabel}, Score: ${r.relevanceScore})\n${mem?.content || ''}`);
              }
            }

            return { content: [{ type: 'text', text: sections.join('\n\n') }] };
          } else {
            const results = ctx.recallTopMemories(limit) as Array<{ type: string; title: string; id: string; confidence: number }>;
            const content = results.map((r) => {
              const mem = ctx.getMemory(r.id);
              return `## [${r.type.toUpperCase()}] ${r.title} (ID: ${r.id})\n${mem?.content || ''}\n---`;
            }).join('\n\n');

            return { content: [{ type: 'text', text: content || 'No memories found.' }] };
          }
        }

        if (request.params.name === 'sd_search') {
          const query = (request.params.arguments?.query as string) || '';
          const memType = request.params.arguments?.type as MemoryType | undefined;

          const results = ctx.searchMemories(query, true, { type: memType }) as Array<{ type: string; title: string; id: string; content_snippet?: string; context?: string }>;
          
          if (results.length === 0) {
            return { content: [{ type: 'text', text: 'No results found.' }] };
          }

          const content = results.map((r) => 
            `## [${r.type.toUpperCase()}] ${r.title} (ID: ${r.id})\n- **Context**: \`${r.context || targetContext}\`\n${r.content_snippet || ''}...\n---`
          ).join('\n\n');

          return { content: [{ type: 'text', text: content }] };
        }

        if (request.params.name === 'sd_get') {
          const id = request.params.arguments?.id as string;
          if (!id) {
            throw new Error('Argument "id" is required for sd_get.');
          }
          const details = ctx.getNodeDetails(id);
          if (!details) {
            return {
              content: [{ type: 'text', text: `Node "${id}" not found in context "${targetContext}" or global context.` }],
              isError: true
            };
          }

          const lines: string[] = [];
          lines.push(`# [${details.nodeType === 'codemap' ? 'FILE VERTEX' : details.type.toUpperCase()}] ${details.title}`);
          lines.push(`- **ID**: \`${details.id}\``);
          lines.push(`- **Context**: \`${details.context}\``);
          lines.push(`- **Type**: \`${details.type}\``);
          if (details.confidence !== undefined) lines.push(`- **Confidence**: \`${details.confidence}\``);
          if (details.tags && details.tags.length > 0) lines.push(`- **Tags**: ${details.tags.map(t => `#${t}`).join(' ')}`);
          if (details.filePath) lines.push(`- **File Path**: \`${details.filePath}\``);
          if (details.created) lines.push(`- **Created**: \`${details.created}\``);
          if (details.updated) lines.push(`- **Updated**: \`${details.updated}\``);
          if (details.accessed) lines.push(`- **Accessed**: \`${details.accessed}\` (count: ${details.access_count ?? 0})`);
          if (details.source) lines.push(`- **Source**: \`${details.source}\``);
          if (details.expires) lines.push(`- **Expires**: \`${details.expires}\``);
          if (details.superseded_by) lines.push(`- **Superseded By**: \`${details.superseded_by}\``);

          if (details.outgoingRelations.length > 0) {
            lines.push(`\n### 🔗 Outgoing Relations (${details.outgoingRelations.length})`);
            for (const rel of details.outgoingRelations) {
              lines.push(`- --(${rel.type})--> **${rel.title || rel.target}** (\`${rel.target}\`)`);
            }
          }

          if (details.incomingRelations.length > 0) {
            lines.push(`\n### 📥 Incoming Relations (${details.incomingRelations.length})`);
            for (const rel of details.incomingRelations) {
              lines.push(`- <--(${rel.type})-- **${rel.title || rel.source}** (\`${rel.source}\`)`);
            }
          }

          if (details.attachedMemories && details.attachedMemories.length > 0) {
            lines.push(`\n### 🧠 Attached Micro-Memories (${details.attachedMemories.length})`);
            for (const mem of details.attachedMemories) {
              lines.push(`- **[${mem.type.toUpperCase()}] ${mem.title}** (\`${mem.id}\`, confidence: ${mem.confidence})`);
            }
          }

          if (details.astOutline && details.astOutline.length > 0) {
            lines.push(`\n### 🌲 AST Symbol Outline`);
            for (const sym of details.astOutline) {
              lines.push(`- ${sym}`);
            }
          }

          if (details.content) {
            lines.push(`\n### 📝 Content\n\n${details.content}`);
          }

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        if (request.params.name === 'sd_delete') {
          const id = request.params.arguments?.id as string;
          if (!id) {
            throw new Error('Argument "id" is required for sd_delete.');
          }
          const existing = ctx.getMemory(id);
          const title = existing?.metadata.title || id;
          ctx.deleteMemory(id);
          return { content: [{ type: 'text', text: `Successfully deleted memory "${title}" (\`${id}\`) from context "${targetContext}".` }] };
        }

        if (request.params.name === 'sd_consolidation_candidates') {
          const threshold = (request.params.arguments?.threshold ?? request.params.arguments?.min_memories) as number | undefined;
          const candidates = ctx.findConsolidationCandidates(threshold);

          if (candidates.length === 0) {
            return { content: [{ type: 'text', text: `No consolidation candidates found matching threshold in context "${targetContext}".` }] };
          }

          const sections: string[] = [];
          sections.push(`## 🎯 Consolidation Candidates (${candidates.length} target node(s) found)`);
          sections.push(`*Tip: Review candidate micro-memories below. If memories represent a coherent topic, use \`sd_consolidate(target_file="...", memory_ids=[...])\` to synthesize them into a guide.*`);

          for (const cand of candidates) {
            sections.push(`\n### Target: ${cand.targetTitle} (\`${cand.target}\`, ${cand.memoryCount} attached micro-memories)`);
            for (const m of cand.memories) {
              const tagStr = m.tags.length > 0 ? ` [${m.tags.map(t => `#${t}`).join(' ')}]` : '';
              sections.push(`- **[${m.type.toUpperCase()}] ${m.title}** (ID: \`${m.id}\`, Conf: ${m.confidence})${tagStr}\n  ${m.summarySnippet}...`);
            }
          }

          return { content: [{ type: 'text', text: sections.join('\n') }] };
        }

        if (request.params.name === 'sd_add') {
          const args = request.params.arguments as {
            type: MemoryType;
            title: string;
            content: string;
            tags?: string[];
            target_file?: string;
            targets?: string[] | string;
            relations?: Array<{ target: string; type?: RelationType }>;
            relation_type?: RelationType;
          };
          if (!args.type || !(USER_CREATABLE_TYPES as readonly string[]).includes(args.type)) {
            throw new Error(`Invalid memory type "${args.type}". Allowed types are: ${USER_CREATABLE_TYPES.join(', ')}. (Tip: 'warning' for gotchas/traps, 'fact' for verified invariants/contracts, 'decision' for ADRs, 'guide' for workflows, 'concept' for domain models).`);
          }
          const targets = args.targets || args.target_file;
          const id = ctx.addMemory(
            args.type,
            args.title,
            args.content,
            args.tags || [],
            'indexer',
            undefined,
            targets,
            args.relation_type || 'affects',
            args.relations
          );
          const mem = ctx.getMemory(id);
          let linkMsg = '';
          if (args.target_file && !args.targets && (!args.relations || args.relations.length === 0)) {
            linkMsg = ` (linked to ${args.target_file})`;
          } else if (mem && mem.metadata.relations.length > 0) {
            linkMsg = ` (linked to ${mem.metadata.relations.length} target(s): ${mem.metadata.relations.map(r => `${r.target}[${r.type}]`).join(', ')})`;
          }
          return { content: [{ type: 'text', text: `Successfully added memory ${id}${linkMsg} to context "${targetContext}"` }] };
        }

        if (request.params.name === 'sd_update') {
          const args = request.params.arguments as {
            id: string;
            title?: string;
            content?: string;
            tags?: string[];
            type?: MemoryType;
            relations?: Array<{ target: string; type: RelationType }>;
            add_targets?: string[] | string;
            remove_targets?: string[] | string;
          };
          if (args.type && !(USER_CREATABLE_TYPES as readonly string[]).includes(args.type)) {
            throw new Error(`Invalid memory type "${args.type}". Allowed types are: ${USER_CREATABLE_TYPES.join(', ')}. (Tip: 'warning' for gotchas/traps, 'fact' for verified invariants/contracts, 'decision' for ADRs, 'guide' for workflows, 'concept' for domain models).`);
          }
          ctx.updateMemory(args.id, args.content, args.title, args.tags, args.type, {
            relations: args.relations,
            addTargets: args.add_targets,
            removeTargets: args.remove_targets
          });
          return { content: [{ type: 'text', text: `Successfully updated memory ${args.id} in context "${targetContext}"` }] };
        }

        if (request.params.name === 'sd_relate') {
          const args = request.params.arguments as {
            source_id: string;
            target: string;
            type?: string;
            relation_type?: string;
          };
          if (!args.source_id || !args.target) {
            throw new Error('Arguments "source_id" and "target" are required for sd_relate.');
          }
          const resolvedTarget = ctx.resolveTargetId(args.target);
          const defaultType = resolvedTarget.startsWith('mem_') ? 'related_to' : 'affects';
          const relType = (args.type || args.relation_type || defaultType) as RelationType;
          const added = ctx.addRelation(args.source_id, args.target, relType);
          if (added) {
            return { content: [{ type: 'text', text: `Successfully linked memory ${args.source_id} -> ${resolvedTarget} with relation "${relType}" in context "${targetContext}".` }] };
          } else {
            return { content: [{ type: 'text', text: `Relation ${args.source_id} -> ${resolvedTarget} (${relType}) already exists in context "${targetContext}".` }] };
          }
        }

        if (request.params.name === 'sd_scan') {
          let dir = request.params.arguments?.directory as string | undefined;
          if (!dir) {
            const ctxConfig = this.config.getContext(targetContext);
            const validBound = ctxConfig?.paths?.find(p => !ConfigManager.isSystemOrHomeRoot(p));
            if (validBound && fs.existsSync(validBound)) {
              dir = validBound;
            } else if (!ConfigManager.isSystemOrHomeRoot(process.cwd())) {
              dir = process.cwd();
            } else {
              return {
                content: [{
                  type: 'text',
                  text: `Error: No workspace directory specified for sd_scan, and current working directory is home/root directory. Please pass explicit 'directory' argument (e.g. { directory: "/path/to/project" }).`
                }],
                isError: true
              };
            }
          }
          const submodulePolicy = (request.params.arguments?.submodule_policy as string) || 'sum';
          const scanOptions = { submodulePolicies: submodulePolicy as 'dive' | 'sum' };
          const { createdCount, decayedCount } = ctx.syncFileGraph(dir, scanOptions);
          return { content: [{ type: 'text', text: `Successfully scanned workspace "${dir}" and updated ${createdCount} file vertices (${decayedCount} memories decayed) in context "${targetContext}".` }] };
        }

        if (request.params.name === 'sd_init') {
          const name = request.params.arguments?.name as string;
          let dir = (request.params.arguments?.directory as string) || process.cwd();
          if (ConfigManager.isSystemOrHomeRoot(dir) && name !== '_global') {
            return {
              content: [{
                type: 'text',
                text: `Error: Cannot initialize context "${name}" on root or home directory "${dir}". Please specify a project sub-directory.`
              }],
              isError: true
            };
          }

          const existing = this.config.getContext(name);
          if (!existing) {
            this.config.addContext(name, [dir]);
          } else {
            this.config.bindPathToContext(name, dir);
          }
          this.sessionWorkspaceDir = path.resolve(dir);

          scaffoldAgentsMd(dir);

          const { ctx: targetCtx } = this.getContext(name);
          const submodulePolicy = (request.params.arguments?.submodule_policy as string) || 'sum';
          const scanOptions = { submodulePolicies: submodulePolicy as 'dive' | 'sum' };
          const { createdCount } = targetCtx.syncFileGraph(dir, scanOptions);
          return { content: [{ type: 'text', text: `Successfully initialized context "${name}", bound path "${dir}", scaffolded AGENTS.md, and created ${createdCount} file vertices in DAG skeleton.` }] };
        }

        if (request.params.name === 'sd_consolidate') {
          const targetFile = request.params.arguments?.target_file as string;
          const memoryIds = request.params.arguments?.memory_ids as string[] | undefined;
          const res = ctx.consolidateNeighborhood(targetFile, { memory_ids: memoryIds });
          if (!res.consolidatedId) {
            return { content: [{ type: 'text', text: `No micro-memories (>= 2) found to consolidate for "${targetFile}".` }] };
          }
          return { content: [{ type: 'text', text: `Successfully consolidated ${res.mergedCount} micro-memories into super-memory ${res.consolidatedId} for target "${targetFile}".` }] };
        }

        if (request.params.name === 'sd_prune') {
          const dir = request.params.arguments?.directory as string | undefined;
          const ctxConfig = this.config.getContext(targetContext);
          const validRoots = dir
            ? [path.resolve(dir)]
            : (ctxConfig?.paths || [process.cwd()]).filter(p => !ConfigManager.isSystemOrHomeRoot(p));

          if (validRoots.length === 0) {
            return {
              content: [{ type: 'text', text: 'Error: No valid workspace roots found to prune against. Please specify a directory.' }],
              isError: true
            };
          }

          const { prunedCount } = ctx.pruneOrphanCodemaps(validRoots);
          return { content: [{ type: 'text', text: `Successfully pruned ${prunedCount} orphaned codemap vertices from context "${targetContext}".` }] };
        }

        throw new Error(`Tool not found: ${request.params.name}`);
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'sd_curate',
            description: 'Holistic memory curation prompt: guided review to consolidate micro-memories, promote generalized rules to _global, and link or prune graph concepts.',
            arguments: [
              {
                name: 'target',
                description: 'Optional target file path or memory ID to focus curation on. Leave empty for a prioritized graph-wide sweep.',
                required: false,
              },
              {
                name: 'threshold',
                description: 'Optional micro-memory threshold for consolidation candidate detection (default: 3).',
                required: false,
              },
              {
                name: 'context',
                description: 'Optional context namespace override (defaults to active workspace context).',
                required: false,
              },
            ],
          },
          {
            name: 'sd_harvest',
            description: 'Discovery harvest prompt: extracts and persists architectural invariants, gotchas, decisions, and patterns discovered during recent work.',
            arguments: [
              {
                name: 'limit',
                description: 'Optional maximum number of recent commits and files to inspect (default: 5).',
                required: false,
              },
              {
                name: 'context',
                description: 'Optional context namespace override (defaults to active workspace context).',
                required: false,
              },
            ],
          },
        ],
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const { ctx } = this.getContextForRequest(request);
      const wsDir = this.sessionWorkspaceDir || (ctx.getWorkspaceRoots()[0] || process.cwd());

      if (name === 'sd_curate') {
        const threshold = args?.threshold ? parseInt(args.threshold as string, 10) : 3;
        const target = (args?.target as string | undefined)?.trim();

        const curateResult = await generateCuratePrompt(ctx, {
          target: target || undefined,
          threshold: isNaN(threshold) ? 3 : threshold,
        });

        return {
          description: curateResult.description,
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: curateResult.promptText,
              },
            },
          ],
        };
      }

      if (name === 'sd_harvest') {
        const limit = args?.limit ? parseInt(args.limit as string, 10) : 5;
        const harvestResult = await generateHarvestPrompt(ctx, {
          limit: isNaN(limit) ? 5 : limit,
          workspaceDir: wsDir,
        });

        return {
          description: harvestResult.description,
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: harvestResult.promptText,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });
  }

  public getServer(): Server {
    return this.server;
  }

  public async run() {
    const ws = this.sessionWorkspaceDir || process.cwd();
    const resolvedContext = this.config.resolveContext(undefined, ws);

    const cleanup = async () => {
      try {
        await this.close();
      } catch {}
      process.exit(0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`StormDrain MCP server running on stdio for workspace "${ws}" [context: "${resolvedContext}"]`);
  }

}

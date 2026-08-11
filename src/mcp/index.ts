import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { FileReader } from '../core/reader';
import { MemoryType } from '../types';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';


export class StormDrainMcpServer {
  private server: Server;
  private config: ConfigManager;
  private reader: FileReader;

  constructor() {
    this.config = new ConfigManager();
    this.reader = new FileReader(this.config);
    
    this.server = new Server(
      {
        name: 'stormdrain',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const active = this.config.resolveContext();
      const ctx = new ContextManager(active);
      const settings = this.config.getSettings();
      
      let injectedMemory = 'No top memories found.';
      try {
        const topMemories = ctx.recallTopMemories(5) as Array<{ type: string; title: string; id: string; content_snippet?: string }>;
        if (topMemories.length > 0) {
          injectedMemory = topMemories.map((m) => 
            `- [${m.type.toUpperCase()}] ${m.title} (ID: ${m.id})\n  ${m.content_snippet ? m.content_snippet.substring(0, 100) : ''}...`
          ).join('\n\n');
        }
      } finally {
        await ctx.close();
      }

      const contextProp = {
        type: 'string',
        description: 'Optional target context namespace override (defaults to auto-resolved workspace context)'
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
          name: 'sd_search',
          description: 'SEARCH TOOL: Perform SQLite FTS5 full-text and semantic keyword search across all persistent memories.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query'
              },
              context: contextProp
            },
            required: ['query']
          }
        },

          {
            name: 'sd_add',
            description: 'POST-DISCOVERY TOOL: Record architectural invariants, non-obvious bugs, failure modes, design decisions, or reusable patterns to persistent memory immediately upon discovery. Can be associated with one or multiple files and/or other memories.',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['fact', 'pattern', 'lesson', 'warning', 'guide', 'codemap', 'sequence'],
                  description: 'Type of memory'
                },
                title: {
                  type: 'string',
                  description: 'Short, descriptive title'
                },
                content: {
                  type: 'string',
                  description: 'Markdown content of the memory'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for categorization'
                },
                target_file: targetFileProp,
                targets: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Multiple target file paths or memory IDs to associate with this memory'
                },
                relations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      target: { type: 'string', description: 'Target memory ID or file path' },
                      type: { 
                        type: 'string', 
                        enum: ['supports', 'contradicts', 'supersedes', 'related_to', 'references', 'depends_on', 'distilled_from', 'part_of', 'affects', 'applies_to'],
                        description: 'Semantic relation type' 
                      }
                    },
                    required: ['target']
                  },
                  description: 'Explicit typed relation edges to other memories or files'
                },
                relation_type: {
                  type: 'string',
                  description: 'Default relation type for targets (default: "affects" for files, "related_to" for memories)'
                },
                context: contextProp
              },
              required: ['type', 'title', 'content']
            }
          },
          {
            name: 'sd_update',
            description: 'UPDATE TOOL: Update an existing memory\'s content, confidence, type, tags, or relation links by ID.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID' },
                title: { type: 'string' },
                content: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                type: { type: 'string', enum: ['fact', 'pattern', 'lesson', 'warning', 'guide', 'codemap', 'sequence'] },
                add_targets: { type: 'array', items: { type: 'string' }, description: 'Target file paths or memory IDs to add' },
                remove_targets: { type: 'array', items: { type: 'string' }, description: 'Target file paths or memory IDs to remove' },
                relations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      target: { type: 'string' },
                      type: { type: 'string' }
                    },
                    required: ['target']
                  },
                  description: 'Replace full relations list'
                },
                context: contextProp
              },
              required: ['id']
            }
          },
          {
            name: 'sd_relate',
            description: 'RELATION TOOL: Connect two memories, or link a memory to a file vertex in the knowledge graph with an explicit semantic relationship (e.g. "supports", "contradicts", "supersedes", "related_to", "references", "depends_on", "part_of", "affects", "applies_to").',
            inputSchema: {
              type: 'object',
              properties: {
                source_id: { type: 'string', description: 'Source memory ID (e.g. "mem_123456")' },
                target: { type: 'string', description: 'Target memory ID or file path (e.g. "mem_789012" or "src/index.ts")' },
                type: { 
                  type: 'string', 
                  enum: ['supports', 'contradicts', 'supersedes', 'related_to', 'references', 'depends_on', 'distilled_from', 'part_of', 'affects', 'applies_to'],
                  description: 'Semantic relation type (default: "related_to" between memories, "affects" for files)'
                },
                context: contextProp
              },
              required: ['source_id', 'target']
            }
          },
          {
            name: 'sd_scan',
            description: 'GRAPH SYNC TOOL: Scan workspace source files (TypeScript, Python, C++, Go, Rust, MATLAB) to synchronize the codebase dependency DAG edges and file vertices in persistent memory.',
            inputSchema: {
              type: 'object',
              properties: {
                directory: {
                  type: 'string',
                  description: 'Optional workspace directory path to scan (defaults to current working directory)'
                },
                submodule_policy: {
                  type: 'string',
                  enum: ['dive', 'sum'],
                  description: 'How to handle git submodules: dive (index all files) or sum (single codemap). Default: sum'
                },
                context: contextProp
              }
            }
          },
          {
            name: 'sd_init',
            description: 'INITIALIZATION TOOL: Initialize a context namespace, bind workspace directory path, and build the initial codebase file DAG skeleton.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Context name (e.g. project name)'
                },
                directory: {
                  type: 'string',
                  description: 'Optional directory path to bind and scan (defaults to current working directory)'
                },
                submodule_policy: {
                  type: 'string',
                  enum: ['dive', 'sum'],
                  description: 'How to handle git submodules: dive (index all files) or sum (single codemap). Default: sum'
                }
              },
              required: ['name']
            }
          },
          {
            name: 'sd_consolidate',
            description: 'CONSOLIDATION TOOL: Consolidate multiple micro-memories attached to a target file vertex into a unified knowledge guide. Automatically activates the Consolidation Shield to suppress repetitive micro-memories from polluting future LLM prompts.',
            inputSchema: {
              type: 'object',
              properties: {
                target_file: {
                  type: 'string',
                  description: 'Target file path (e.g. src/core/config.ts) whose micro-memories should be consolidated'
                },
                context: contextProp
              },
              required: ['target_file']
            }
          },
          {
            name: 'sd_prune',
            description: 'GRAPH PRUNE TOOL: Prune leaked or orphaned codemap file vertices from the DAG that do not belong to the workspace.',
            inputSchema: {
              type: 'object',
              properties: {
                directory: {
                  type: 'string',
                  description: 'Optional directory path to validate against (defaults to context bound paths)'
                },
                context: contextProp
              }
            }
          }
        );

        return { tools };
      });



    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const explicitContext = request.params.arguments?.context as string | undefined;
      const targetContext = this.config.resolveContext(explicitContext, process.cwd());
      const ctx = new ContextManager(targetContext);

      try {
        if (request.params.name === 'sd_read') {
          const args = request.params.arguments as {
            path?: string;
            filePath?: string;
            start_line?: number;
            startLine?: number;
            end_line?: number;
            endLine?: number;
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

          const startLine = args.start_line !== undefined ? args.start_line : args.startLine;
          const endLine = args.end_line !== undefined ? args.end_line : args.endLine;
          const includeInvariants = args.include_invariants !== undefined ? args.include_invariants : args.includeInvariants;
          const includeSymbols = args.include_symbols !== undefined ? args.include_symbols : args.includeSymbols;

          const result = await this.reader.readFile({
            filePath: targetPath,
            startLine,
            endLine,
            includeInvariants,
            includeSymbols,
            context: targetContext,
            cwd: process.cwd()
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
          const results = ctx.searchMemories(query) as Array<{ type: string; title: string; id: string; content_snippet?: string }>;
          
          const content = results.map((r) => 
            `## [${r.type.toUpperCase()}] ${r.title} (ID: ${r.id})\n${r.content_snippet || ''}...\n---`
          ).join('\n\n');

          return { content: [{ type: 'text', text: content || 'No results found.' }] };
        }

        if (request.params.name === 'sd_add') {
          const args = request.params.arguments as {
            type: MemoryType;
            title: string;
            content: string;
            tags?: string[];
            target_file?: string;
            targets?: string[] | string;
            relations?: Array<{ target: string; type?: string }>;
            relation_type?: string;
          };
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
            args.relations as any
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
            relations?: Array<{ target: string; type?: string }>;
            add_targets?: string[] | string;
            remove_targets?: string[] | string;
          };
          ctx.updateMemory(args.id, args.content, args.title, args.tags, args.type, {
            relations: args.relations as any,
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
          };
          if (!args.source_id || !args.target) {
            throw new Error('Arguments "source_id" and "target" are required for sd_relate.');
          }
          const resolvedTarget = ctx.resolveTargetId(args.target);
          const defaultType = resolvedTarget.startsWith('mem_') ? 'related_to' : 'affects';
          const relType = args.type || defaultType;
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
          this.config.setActiveContext(name);

          scaffoldAgentsMd(dir);

          const targetCtx = new ContextManager(name);
          try {
            const submodulePolicy = (request.params.arguments?.submodule_policy as string) || 'sum';
            const scanOptions = { submodulePolicies: submodulePolicy as 'dive' | 'sum' };
            const { createdCount } = targetCtx.syncFileGraph(dir, scanOptions);
            return { content: [{ type: 'text', text: `Successfully initialized context "${name}", bound path "${dir}", scaffolded AGENTS.md, and created ${createdCount} file vertices in DAG skeleton.` }] };
          } finally {
            await targetCtx.close();
          }
        }

        if (request.params.name === 'sd_consolidate') {
          const targetFile = request.params.arguments?.target_file as string;
          const res = ctx.consolidateNeighborhood(targetFile);
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
      } finally {
        await ctx.close();
      }
    });
  }

  public getServer(): Server {
    return this.server;
  }

  public async run() {
    const cwd = process.cwd();
    const resolvedContext = this.config.resolveContext(undefined, cwd);
    if (!ConfigManager.isSystemOrHomeRoot(cwd)) {
      this.config.bindPathToContext(resolvedContext, cwd);
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`StormDrain MCP server running on stdio for workspace "${cwd}" [context: "${resolvedContext}"]`);
  }

}

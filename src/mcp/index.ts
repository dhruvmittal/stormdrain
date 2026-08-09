import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { MemoryType } from '../types';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';

export class StormDrainMcpServer {
  private server: Server;
  private config: ConfigManager;

  constructor() {
    this.config = new ConfigManager();
    
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

      return {
        tools: [
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
            description: 'POST-DISCOVERY TOOL: Record architectural invariants, non-obvious bugs, failure modes, design decisions, or reusable patterns to persistent memory immediately upon discovery. Always pass target_file when the memory applies to a specific file.',
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
                context: contextProp
              },
              required: ['type', 'title', 'content']
            }
          },
          {
            name: 'sd_update',
            description: 'UPDATE TOOL: Update an existing memory\'s content, confidence, type, or tags by ID.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID' },
                title: { type: 'string' },
                content: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                context: contextProp
              },
              required: ['id']
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
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const explicitContext = request.params.arguments?.context as string | undefined;
      const targetContext = this.config.resolveContext(explicitContext, process.cwd());
      const ctx = new ContextManager(targetContext);

      try {
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
          };
          const id = ctx.addMemory(args.type, args.title, args.content, args.tags || [], 'indexer', undefined, args.target_file);
          const linkMsg = args.target_file ? ` (linked to ${args.target_file})` : '';
          return { content: [{ type: 'text', text: `Successfully added memory ${id}${linkMsg} to context "${targetContext}"` }] };
        }

        if (request.params.name === 'sd_update') {
          const args = request.params.arguments as { id: string; title?: string; content?: string; tags?: string[]; type?: MemoryType };
          ctx.updateMemory(args.id, args.content, args.title, args.tags, args.type);
          return { content: [{ type: 'text', text: `Successfully updated memory ${args.id} in context "${targetContext}"` }] };
        }

        if (request.params.name === 'sd_scan') {
          const dir = (request.params.arguments?.directory as string) || process.cwd();
          const { createdCount, decayedCount } = ctx.syncFileGraph(dir);
          return { content: [{ type: 'text', text: `Successfully scanned workspace "${dir}" and updated ${createdCount} file vertices (${decayedCount} memories decayed) in context "${targetContext}".` }] };
        }

        if (request.params.name === 'sd_init') {
          const name = request.params.arguments?.name as string;
          const dir = (request.params.arguments?.directory as string) || process.cwd();

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
            const { createdCount } = targetCtx.syncFileGraph(dir);
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
    this.config.bindPathToContext(resolvedContext, cwd);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`StormDrain MCP server running on stdio for workspace "${cwd}" [context: "${resolvedContext}"]`);
  }
}

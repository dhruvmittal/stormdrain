import { Command } from 'commander';
import * as path from 'path';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { StormDrainMcpServer } from '../mcp/index';
import { startWebServer } from '../web/server';
import { generateCodebaseCodemap } from '../utils/codemapGenerator';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';

const program = new Command();
program
  .name('stormdrain')
  .description('A persistent memory layer for software engineering agents')
  .version('1.0.0');

const config = new ConfigManager();

program
  .command('init')
  .description('Initialize a context, bind workspace directory, and build codebase file DAG')
  .argument('[name]', 'Context name (defaults to directory name or resolved context)')
  .argument('[dir]', 'Workspace directory path (defaults to current working directory)')
  .action(async (name, dir) => {
    const targetDir = dir || process.cwd();
    const folderName = path.basename(path.resolve(targetDir));
    const targetContextName = name || folderName;

    const existing = config.getContext(targetContextName);
    if (!existing) {
      config.addContext(targetContextName, [targetDir]);
      console.log(`Created context "${targetContextName}" and bound path "${targetDir}"`);
    } else {
      config.bindPathToContext(targetContextName, targetDir);
      console.log(`Bound path "${targetDir}" to existing context "${targetContextName}"`);
    }

    config.setActiveContext(targetContextName);

    const scaffoldRes = scaffoldAgentsMd(targetDir);
    if (scaffoldRes.created) {
      console.log(`Scaffolded agent instructions in "${path.relative(process.cwd(), scaffoldRes.filePath) || 'AGENTS.md'}"`);
    } else if (scaffoldRes.updated) {
      console.log(`Appended StormDrain instructions to existing "${path.relative(process.cwd(), scaffoldRes.filePath) || 'AGENTS.md'}"`);
    }

    const ctx = new ContextManager(targetContextName);
    try {
      const { createdCount } = ctx.syncFileGraph(targetDir);
      console.log(`Successfully initialized context "${targetContextName}" with ${createdCount} file vertices in DAG skeleton.`);
    } finally {
      await ctx.close();
    }
  });

program
  .command('graph')
  .description('Graph operations')
  .argument('<action>', 'scan, consolidate')
  .argument('[target]', 'Workspace directory path for scan, or target file path for consolidate')
  .option('-c, --context <name>', 'Target context override')
  .action(async (action, target, options) => {
    if (action === 'scan') {
      const targetDir = target || process.cwd();
      const targetCtxName = config.resolveContext(options.context, targetDir);
      const ctx = new ContextManager(targetCtxName);
      try {
        const { createdCount, decayedCount } = ctx.syncFileGraph(targetDir);
        const decayMsg = decayedCount > 0 ? ` (${decayedCount} memories decayed due to file content changes)` : '';
        console.log(`Scanned workspace source files and updated ${createdCount} file vertices & import DAG edges in context "${targetCtxName}"${decayMsg}.`);
      } finally {
        await ctx.close();
      }
    } else if (action === 'consolidate') {
      if (!target) {
        console.error('Error: Please specify target file path to consolidate (e.g. stormdrain graph consolidate src/core/config.ts)');
        process.exit(1);
      }
      const targetCtxName = config.resolveContext(options.context, process.cwd());
      const ctx = new ContextManager(targetCtxName);
      try {
        const res = ctx.consolidateNeighborhood(target);
        if (!res.consolidatedId) {
          console.log(`No micro-memories (>= 2) found to consolidate for "${target}".`);
        } else {
          console.log(`Successfully consolidated ${res.mergedCount} micro-memories into super-memory ${res.consolidatedId} for target "${target}".`);
        }
      } finally {
        await ctx.close();
      }
    }
  });

program
  .command('codemap')
  .description('Generate or update codebase codemap memory for target workspace')
  .argument('[dir]', 'Workspace directory path (defaults to current working directory)')
  .option('-c, --context <name>', 'Target context override')
  .action(async (dir, options) => {
    const targetDir = dir || process.cwd();
    const targetCtxName = config.resolveContext(options.context, targetDir);

    const { title, content } = generateCodebaseCodemap(targetDir);
    const ctx = new ContextManager(targetCtxName);
    try {
      const id = ctx.addMemory('codemap', title, content, ['codemap', 'structure']);
      console.log(`Successfully generated codemap memory (${id}) in context "${targetCtxName}"`);
    } finally {
      await ctx.close();
    }
  });

program
  .command('context')
  .description('Manage contexts')
  .argument('<action>', 'list, create, use, bind')
  .argument('[name]', 'Context name')
  .argument('[dir]', 'Directory path to bind (defaults to current directory)')
  .action((action, name, dir) => {
    if (action === 'list') {
      const contexts = config.getContexts();
      const resolved = config.resolveContext(undefined, process.cwd());
      const active = config.getActiveContext();
      console.log(`Contexts (Current workspace resolved context: "${resolved}"):`);
      for (const ctx of Object.values(contexts)) {
        const isResolved = ctx.name === resolved;
        const isActive = ctx.name === active;
        const marker = isResolved ? '*' : (isActive ? '◦' : ' ');
        const pathsStr = (ctx.paths && ctx.paths.length > 0) ? ` [paths: ${ctx.paths.join(', ')}]` : '';
        console.log(`  ${marker} ${ctx.name}${pathsStr}`);
      }
    } else if (action === 'create' && name) {
      try {
        const cwd = dir || process.cwd();
        config.addContext(name, [cwd]);
        console.log(`Created context "${name}" and bound path "${cwd}"`);
      } catch (e: any) {
        console.error(e.message);
      }
    } else if (action === 'use' && name) {
      try {
        config.setActiveContext(name);
        const cwd = dir || process.cwd();
        config.bindPathToContext(name, cwd);
        console.log(`Switched default active context to "${name}" and bound path "${cwd}"`);
      } catch (e: any) {
        console.error(e.message);
      }
    } else if (action === 'bind' && name) {
      try {
        const bindPath = dir || process.cwd();
        config.bindPathToContext(name, bindPath);
        console.log(`Bound path "${bindPath}" to context "${name}"`);
      } catch (e: any) {
        console.error(e.message);
      }
    }
  });

program
  .command('add')
  .description('Add a new memory')
  .argument('<type>', 'Type of memory (fact, lesson, pattern, warning, etc.)')
  .argument('<title>', 'Title of the memory')
  .argument('<content>', 'Markdown content of the memory')
  .option('-c, --context <name>', 'Target context override')
  .option('-t, --target <file>', 'Target file to link memory onto in the DAG')
  .action(async (type, title, content, options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      const id = ctx.addMemory(type as any, title, content, [], 'manual', undefined, options.target);
      const linkMsg = options.target ? ` (linked to ${options.target})` : '';
      console.log(`Added memory ${id}${linkMsg} to context "${targetCtxName}"`);
    } finally {
      await ctx.close();
    }
  });

program
  .command('search')
  .description('Search memories')
  .argument('<query>', 'Search query')
  .option('-c, --context <name>', 'Target context override')
  .action(async (query, options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      const results = ctx.searchMemories(query);
      if (results.length === 0) {
        console.log(`No memories found in context "${targetCtxName}".`);
      } else {
        for (const r of results as any[]) {
          console.log(`\n[${r.type.toUpperCase()}] ${r.title} (${r.id})`);
          console.log(`Confidence: ${r.confidence}`);
          console.log(r.content_snippet.substring(0, 200) + '...');
        }
      }
    } finally {
      await ctx.close();
    }
  });

program
  .command('recall')
  .description('Recall top memories for current context or graph-connected memories for a target file')
  .option('-c, --context <name>', 'Target context override')
  .option('-t, --target <file>', 'Target file to traverse graph from')
  .action(async (options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      if (options.target) {
        const results = ctx.recallGraph(options.target, 2);
        console.log(`Graph memories for target "${options.target}" in context "${targetCtxName}":`);
        for (const r of results as any[]) {
          console.log(`- [Depth ${r.depth}] [${r.type}] ${r.title} (${r.id})`);
        }
      } else {
        const results = ctx.recallTopMemories(5);
        console.log(`Top memories for context "${targetCtxName}":`);
        for (const r of results as any[]) {
          console.log(`- [${r.type}] ${r.title} (Confidence: ${r.confidence})`);
        }
      }
    } finally {
      await ctx.close();
    }
  });

program
  .command('serve')
  .description('Start the StormDrain MCP server (stdio)')
  .action(async () => {
    const server = new StormDrainMcpServer();
    await server.run();
  });

program
  .command('web')
  .description('Start the StormDrain Web UI')
  .option('-p, --port <number>', 'Port to run the server on', '3456')
  .action((options) => {
    startWebServer(parseInt(options.port, 10));
  });

program.parse();

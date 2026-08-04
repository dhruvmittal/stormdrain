import { Command } from 'commander';
import * as path from 'path';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { StormDrainMcpServer } from '../mcp/index';
import { startWebServer } from '../web/server';
import { generateCodebaseCodemap } from '../utils/codemapGenerator';

const program = new Command();
program
  .name('stormdrain')
  .description('A persistent memory layer for software engineering agents')
  .version('1.0.0');

const config = new ConfigManager();

program
  .command('init')
  .description('Initialize a context and generate an initial codebase codemap')
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

    const { title, content } = generateCodebaseCodemap(targetDir);
    const ctx = new ContextManager(targetContextName);
    try {
      const id = ctx.addMemory('codemap', title, content, ['codemap', 'auto-init', 'structure']);
      console.log(`Successfully initialized context "${targetContextName}" with codebase codemap memory (${id})`);
    } finally {
      await ctx.close();
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
  .argument('<type>', 'Type of memory (fact, lesson, pattern, etc.)')
  .argument('<title>', 'Title of the memory')
  .argument('<content>', 'Markdown content of the memory')
  .option('-c, --context <name>', 'Target context override')
  .action(async (type, title, content, options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      const id = ctx.addMemory(type as any, title, content);
      console.log(`Added memory ${id} to context "${targetCtxName}"`);
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
  .description('Recall top memories for current context')
  .option('-c, --context <name>', 'Target context override')
  .action(async (options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      const results = ctx.recallTopMemories(5);
      console.log(`Top memories for context "${targetCtxName}":`);
      for (const r of results as any[]) {
        console.log(`- [${r.type}] ${r.title} (Confidence: ${r.confidence})`);
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

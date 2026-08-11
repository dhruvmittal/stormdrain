import { Command } from 'commander';
import * as path from 'path';
import * as readline from 'readline';
import { ConfigManager } from '../core/config';
import { ContextManager } from '../core/context';
import { FileReader } from '../core/reader';
import { StormDrainMcpServer } from '../mcp/index';
import { startWebServer } from '../web/server';
import { generateCodebaseCodemap } from '../utils/codemapGenerator';
import { scaffoldAgentsMd } from '../utils/agentsScaffolder';
import { getSubmodules, SubmoduleInfo } from '../utils/gitUtils';
import { SubmodulePolicy } from '../utils/fileGraphScanner';


const program = new Command();
program
  .name('stormdrain')
  .description('A persistent memory layer for software engineering agents')
  .version('1.0.0');

const config = new ConfigManager();

/**
 * Prompt user interactively for submodule policy.
 * Returns 'dive' or 'sum'. Only works when stdin is a TTY.
 */
async function promptSubmodulePolicy(sub: SubmoduleInfo): Promise<SubmodulePolicy> {
  if (!process.stdin.isTTY) return 'sum';

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<SubmodulePolicy>((resolve) => {
    rl.question(
      `  Submodule detected: "${sub.path}"${sub.url ? ` (${sub.url})` : ''}\n  Dive in (index all files) or Sum up (single codemap)? [dive/sum] (default: sum): `,
      (answer) => {
        rl.close();
        const trimmed = (answer || '').trim().toLowerCase();
        resolve(trimmed === 'dive' ? 'dive' : 'sum');
      }
    );
  });
}

/**
 * Resolve submodule policies for a workspace, either from CLI flag or interactive prompts.
 */
async function resolveSubmodulePolicies(
  workspaceDir: string,
  policyFlag?: string
): Promise<Record<string, SubmodulePolicy> | SubmodulePolicy | undefined> {
  const submodules = getSubmodules(workspaceDir);
  if (submodules.length === 0) return undefined;

  // Explicit blanket policy
  if (policyFlag === 'dive' || policyFlag === 'sum') {
    return policyFlag;
  }

  // Interactive: ask for each submodule
  if (policyFlag === 'ask' || !policyFlag) {
    if (!process.stdin.isTTY) {
      console.log(`Found ${submodules.length} submodule(s). Using default policy: sum (non-interactive mode).`);
      return 'sum';
    }

    console.log(`Found ${submodules.length} submodule(s):`);
    const policies: Record<string, SubmodulePolicy> = {};
    for (const sub of submodules) {
      policies[sub.path] = await promptSubmodulePolicy(sub);
    }
    return policies;
  }

  return undefined;
}

program
  .command('init')
  .description('Initialize a context, bind workspace directory, and build codebase file DAG')
  .argument('[name]', 'Context name (defaults to directory name or resolved context)')
  .argument('[dir]', 'Workspace directory path (defaults to current working directory)')
  .option('--submodules <policy>', 'Submodule handling policy: dive, sum, or ask (default: ask)')
  .action(async (name, dir, options) => {
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

    const submodulePolicies = await resolveSubmodulePolicies(targetDir, options.submodules);

    const ctx = new ContextManager(targetContextName);
    try {
      const { createdCount } = ctx.syncFileGraph(targetDir, { submodulePolicies });
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
  .option('--submodules <policy>', 'Submodule handling policy: dive, sum, or ask (default: ask)')
  .action(async (action, target, options) => {
    if (action === 'scan') {
      const targetDir = target || process.cwd();
      const targetCtxName = config.resolveContext(options.context, targetDir);

      const submodulePolicies = await resolveSubmodulePolicies(targetDir, options.submodules);

      const ctx = new ContextManager(targetCtxName);
      try {
        const { createdCount, decayedCount } = ctx.syncFileGraph(targetDir, { submodulePolicies });
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
  .argument('<action>', 'list, create, use, bind, unbind, delete')
  .argument('[name]', 'Context name')
  .argument('[dir]', 'Directory path to bind (defaults to current directory)')
  .option('-f, --force', 'Skip confirmation prompts')
  .option('--purge', 'Purge context data from disk (default: true for delete)')
  .option('--no-purge', 'Keep context data on disk after deletion')
  .action(async (action, name, dir, options) => {
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
        const ok = config.bindPathToContext(name, bindPath);
        if (ok) {
          console.log(`Bound path "${bindPath}" to context "${name}"`);
        } else {
          console.log(`Path "${bindPath}" was already bound or rejected (root/home directory guard).`);
        }
      } catch (e: any) {
        console.error(e.message);
      }
    } else if (action === 'unbind' && name) {
      try {
        const unbindPath = dir || process.cwd();
        const ok = config.unbindPathFromContext(name, unbindPath);
        if (ok) {
          console.log(`Unbound path "${unbindPath}" from context "${name}"`);
        } else {
          console.log(`Path "${unbindPath}" was not bound to context "${name}"`);
        }
      } catch (e: any) {
        console.error(e.message);
      }
    } else if ((action === 'delete' || action === 'rm') && name) {
      // Delete context with safety guards
      try {
        if (name === '_global') {
          console.error('Error: Cannot delete the _global context — it is the system fallback.');
          process.exit(1);
        }

        const existing = config.getContext(name);
        if (!existing) {
          console.error(`Error: Context "${name}" does not exist.`);
          process.exit(1);
        }

        // Confirmation prompt unless --force
        if (!options.force && process.stdin.isTTY) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            const pathsInfo = existing.paths?.length ? ` (bound paths: ${existing.paths.join(', ')})` : '';
            rl.question(`Delete context "${name}"${pathsInfo}? This will remove all memories and data. [y/N]: `, resolve);
          });
          rl.close();

          if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
            console.log('Aborted.');
            return;
          }
        }

        const purgeDisk = options.purge !== false; // default true
        config.deleteContext(name, purgeDisk);

        const purgeMsg = purgeDisk ? ' and purged from disk' : '';
        console.log(`Context "${name}" deleted${purgeMsg}. Active context is now "${config.getActiveContext()}".`);
      } catch (e: any) {
        console.error(e.message);
      }
    } else {
      console.error(`Unknown action "${action}" or missing context name. Available: list, create, use, bind, unbind, delete`);
    }
  });

program
  .command('rm')
  .alias('remove')
  .description('Remove files, directories, or wildcard patterns from context memory')
  .argument('<pattern>', 'File path, directory, or glob pattern (e.g. "data/*", "sim_output/**", "*.csv")')
  .option('-c, --context <name>', 'Target context override')
  .option('--dry-run', 'Show what would be removed without actually deleting')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (pattern, options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);

    try {
      // First, dry-run to show matches
      const preview = ctx.removeVerticesByPattern(pattern, { dryRun: true });

      if (preview.matchedCount === 0) {
        console.log(`No file vertices matching "${pattern}" found in context "${targetCtxName}".`);
        return;
      }

      console.log(`Found ${preview.matchedCount} matching file vertex/vertices in context "${targetCtxName}":`);
      for (const f of preview.matchedFiles) {
        console.log(`  - ${f}`);
      }

      if (options.dryRun) {
        console.log('\n(dry run — no changes made)');
        return;
      }

      // Confirmation unless --force
      if (!options.force && process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`\nRemove ${preview.matchedCount} file vertex/vertices? [y/N]: `, resolve);
        });
        rl.close();

        if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
          console.log('Aborted.');
          return;
        }
      }

      const result = ctx.removeVerticesByPattern(pattern);
      console.log(`Removed ${result.removedCount} file vertex/vertices from context "${targetCtxName}".`);
    } finally {
      await ctx.close();
    }
  });

program
  .command('prune')
  .description('Prune leaked or orphaned codemap file vertices from the DAG')
  .option('-c, --context <name>', 'Target context override')
  .option('-d, --dir <directory>', 'Explicit workspace directory root')
  .action(async (options) => {
    const targetCtxName = config.resolveContext(options.context, process.cwd());
    const ctx = new ContextManager(targetCtxName);
    try {
      const ctxConfig = config.getContext(targetCtxName);
      const validRoots = options.dir
        ? [path.resolve(options.dir)]
        : (ctxConfig?.paths || [process.cwd()]).filter(p => !ConfigManager.isSystemOrHomeRoot(p));

      if (validRoots.length === 0) {
        console.error('No valid workspace roots found to prune against. Please pass -d <directory>.');
        return;
      }

      const { prunedCount } = ctx.pruneOrphanCodemaps(validRoots);
      console.log(`Pruned ${prunedCount} orphaned codemap vertices from context "${targetCtxName}".`);
    } finally {
      await ctx.close();
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
  .command('read')
  .description('Read a workspace file with injected topological invariants, symbol outlines, and line numbers')
  .argument('<path>', 'Path to file to read')
  .option('-s, --start <number>', 'Start line number (1-indexed)')
  .option('-e, --end <number>', 'End line number (1-indexed)')
  .option('-c, --context <name>', 'Target context override')
  .option('--no-invariants', 'Disable invariant header injection')
  .option('--symbols', 'Include exported symbol outline')
  .action(async (targetPath, options) => {
    const reader = new FileReader(config);
    try {
      const result = await reader.readFile({
        filePath: targetPath,
        startLine: options.start ? parseInt(options.start, 10) : undefined,
        endLine: options.end ? parseInt(options.end, 10) : undefined,
        includeInvariants: options.invariants,
        includeSymbols: options.symbols,
        context: options.context
      });
      console.log(result.content);
    } catch (err: any) {
      console.error(`Error reading file: ${err.message}`);
      process.exit(1);
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

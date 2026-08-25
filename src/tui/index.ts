import { TuiOptions } from './types';
import { ConfigManager } from '../core/config';
import { TuiDataFetcher } from './data';
import { renderConfidenceBar } from './components/OverviewPane';
import { InkContext } from './inkContext';

export async function runTui(options: TuiOptions = {}): Promise<void> {
  const config = new ConfigManager();
  const contextName = config.resolveContext(options.context, process.cwd());

  if (options.snapshot) {
    // Non-interactive snapshot mode: print text dashboard to stdout and exit
    const fetcher = new TuiDataFetcher(config);
    const metrics = fetcher.getContextMetrics(contextName);
    const memories = fetcher.getMemories(contextName);
    const candidates = fetcher.getCandidates(contextName);

    const confBar = renderConfidenceBar(metrics.avgConfidence, 15);

    console.log(`\n===============================================================`);
    console.log(`⛈️  STORM DRAIN TUI TELEMETRY SNAPSHOT [Context: ${contextName}]`);
    console.log(`===============================================================`);
    console.log(`- Total Memories: ${metrics.totalMemories}`);
    console.log(`- Codemap File Vertices: ${metrics.codemapVertices}`);
    console.log(`- Consolidation Candidates: ${metrics.consolidationCandidatesCount} target(s)`);
    console.log(`- Decayed/Stale Memories: ${metrics.decayedMemoriesCount}`);
    console.log(`- Average Confidence: ${(metrics.avgConfidence * 100).toFixed(0)}% [${confBar}]`);
    console.log(`- Bound Paths: ${metrics.boundPaths.join(', ') || 'none'}`);

    if (candidates.length > 0) {
      console.log(`\n🎯 Consolidation Candidates (${candidates.length}):`);
      for (const cand of candidates) {
        console.log(`  * ${cand.targetTitle} (${cand.target}) - ${cand.memoryCount} attached micro-memories`);
      }
    }

    console.log(`\n🧠 Recent Memories (${Math.min(5, memories.length)}):`);
    for (const m of memories.slice(0, 5)) {
      console.log(`  - [${m.metadata.type.toUpperCase()}] ${m.metadata.title} (conf: ${m.metadata.confidence}, id: ${m.metadata.id})`);
    }
    console.log(`===============================================================\n`);
    return;
  }

  // Enter terminal alternate screen buffer & hide cursor for 100% full-screen TUI experience
  process.stdout.write('\x1b[?1049h\x1b[H');

  let restored = false;
  const restoreTerminal = () => {
    if (!restored) {
      restored = true;
      process.stdout.write('\x1b[?1049l\x1b[?25h');
    }
  };

  process.once('exit', restoreTerminal);
  process.once('SIGINT', () => {
    restoreTerminal();
    process.exit(0);
  });

  try {
    // Dynamically load ESM-only Ink framework for interactive execution in CJS runtime
    const inkModule = await (eval('import("ink")') as Promise<any>);
    const ReactModule = await (eval('import("react")') as Promise<typeof import('react')>);
    const React = ReactModule.default || ReactModule;
    const { App } = await import('./App');

    const inkValue = {
      Box: inkModule.Box,
      Text: inkModule.Text,
      useApp: inkModule.useApp,
      useInput: inkModule.useInput
    };

    const element = React.createElement(
      InkContext.Provider,
      { value: inkValue },
      React.createElement(App, { contextName })
    );

    const app = inkModule.render(element);
    await app.waitUntilExit();
  } finally {
    restoreTerminal();
  }
}

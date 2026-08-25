import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ContextManager } from '../core/context';
import { ConfigManager } from '../core/config';
import { TuiDataFetcher } from './data';
import { flattenTree } from './components/DagTreePane';
import { renderConfidenceBar } from './components/OverviewPane';
import { runTui } from './index';

describe('StormDrain TUI Engine & Data Pipeline', () => {
  let tempDir: string;
  const testContext = 'test_tui_context';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain-tui-test-'));
    process.env.STORMDRAIN_TEST_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.STORMDRAIN_TEST_DIR;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('renders confidence sparkline gauge correctly', () => {
    const full = renderConfidenceBar(1.0, 10);
    expect(full).toBe('██████████');

    const half = renderConfidenceBar(0.5, 10);
    expect(half).toBe('█████░░░░░');

    const zero = renderConfidenceBar(0, 10);
    expect(zero).toBe('░░░░░░░░░░');
  });

  it('fetches context metrics, memories, and candidate clusters', () => {
    const config = new ConfigManager();
    config.addContext(testContext, [tempDir]);

    const ctx = new ContextManager(testContext);
    const mem1 = ctx.addMemory('pattern', 'Cache Prepared Statements', 'Use better-sqlite3 prepared statements.', ['db', 'performance'], 'manual', undefined, 'src/db.ts');
    const mem2 = ctx.addMemory('warning', 'Sync Write Locks', 'Avoid parallel write transactions.', ['db', 'concurrency'], 'manual', undefined, 'src/db.ts');
    const mem3 = ctx.addMemory('lesson', 'SQLite FTS Indexing', 'Rebuild FTS index on update.', ['db', 'search'], 'manual', undefined, 'src/db.ts');
    ctx.close();

    const fetcher = new TuiDataFetcher(config);

    const metrics = fetcher.getContextMetrics(testContext);
    expect(metrics.contextName).toBe(testContext);
    expect(metrics.totalMemories).toBe(3);
    expect(metrics.consolidationCandidatesCount).toBe(1);

    const memories = fetcher.getMemories(testContext);
    expect(memories.length).toBe(3);

    const candidates = fetcher.getCandidates(testContext);
    expect(candidates.length).toBe(1);
    expect(candidates[0].memoryCount).toBe(3);
  });

  it('flattens file DAG hierarchy tree correctly', () => {
    const mockTree = {
      name: 'root',
      path: '',
      files: [
        {
          id: 'file_src_main_ts',
          relativePath: 'src/main.ts',
          imports: [],
          attachedMemories: [
            { id: 'mem_1', type: 'pattern' as const, title: 'Main Loop Pattern', confidence: 0.95 }
          ]
        }
      ],
      subfolders: {
        src: {
          name: 'src',
          path: 'src',
          files: [],
          subfolders: {}
        }
      }
    };

    const items = flattenTree(mockTree);
    expect(items.length).toBe(3);
    expect(items[0].label).toBe('📁 src/');
    expect(items[1].label).toBe('📄 main.ts');
    expect(items[2].label).toContain('Main Loop Pattern');
  });

  it('executes non-interactive snapshot mode without throwing', async () => {
    const config = new ConfigManager();
    config.addContext(testContext, [tempDir]);

    const ctx = new ContextManager(testContext);
    ctx.addMemory('fact', 'Snapshot Test Invariant', 'Ensures snapshot output works.', ['test']);
    ctx.close();

    await expect(runTui({ context: testContext, snapshot: true })).resolves.not.toThrow();
  });
});

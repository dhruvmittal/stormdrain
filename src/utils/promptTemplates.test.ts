import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from '../core/context';
import { generateCuratePrompt } from './promptTemplates';

describe('Prompt Templates Engine: /sd_curate', () => {
  let tempDir: string;
  let ctx: ContextManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_prompts_test_'));
    process.env.STORMDRAIN_TEST_DIR = tempDir;
    ctx = new ContextManager('test_curate_ctx');
  });

  afterEach(async () => {
    if (ctx) await ctx.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('generates focused curation prompt for a target file vertex with attached micro-memories', async () => {
    // Add 3 micro-memories targeting a file
    ctx.addMemory(
      'warning',
      'Context Locking Invariant',
      'Must release context locks before terminating process.',
      ['#invariant', '#concurrency'],
      'manual',
      undefined,
      'src/core/context.ts'
    );
    ctx.addMemory(
      'pattern',
      'Transaction Rollback Pattern',
      'Always wrap SQLite updates in immediate transactions.',
      ['#pattern', '#sqlite'],
      'manual',
      undefined,
      'src/core/context.ts'
    );
    ctx.addMemory(
      'lesson',
      'FTS Index Desync Gotcha',
      'Deleting memory requires explicit FTS purge.',
      ['#lesson', '#fts'],
      'manual',
      undefined,
      'src/core/context.ts'
    );

    const result = await generateCuratePrompt(ctx, { target: 'src/core/context.ts', threshold: 3 });

    expect(result.title).toContain('Curate Target: src/core/context.ts');
    expect(result.promptText).toContain('StormDrain Knowledge Curation');
    expect(result.promptText).toContain('Context Locking Invariant');
    expect(result.promptText).toContain('Transaction Rollback Pattern');
    expect(result.promptText).toContain('FTS Index Desync Gotcha');
    expect(result.promptText).toContain('sd_consolidate(target_file="src/core/context.ts"');
  });

  it('generates graceful not-found curation prompt for non-existent target', async () => {
    const result = await generateCuratePrompt(ctx, { target: 'src/non_existent.ts' });

    expect(result.promptText).toContain('Target node `src/non_existent.ts` was not found');
    expect(result.promptText).toContain('sd_search');
  });

  it('generates graph-wide sweep curation prompt identifying consolidation candidates, promotion candidates, and orphans', async () => {
    // 1. Target with 3 micro-memories
    ctx.addMemory(
      'pattern',
      'Scanner Pattern 1',
      'First scanner pattern',
      [],
      'manual',
      undefined,
      'src/utils/scanner.ts'
    );
    ctx.addMemory(
      'pattern',
      'Scanner Pattern 2',
      'Second scanner pattern',
      [],
      'manual',
      undefined,
      'src/utils/scanner.ts'
    );
    ctx.addMemory(
      'pattern',
      'Scanner Pattern 3',
      'Third scanner pattern',
      [],
      'manual',
      undefined,
      'src/utils/scanner.ts'
    );

    // 2. Promotion candidate (environment / tooling fact)
    ctx.addMemory(
      'fact',
      'NixOS Dynamic Linker Invariant',
      'GCC on NixOS requires patchelf for C++ libraries.',
      ['#environment', '#nixos']
    );

    // 3. Orphan memory
    ctx.addMemory(
      'lesson',
      'Floating Lesson Without Targets',
      'Some standalone observation without links.'
    );

    const result = await generateCuratePrompt(ctx, { threshold: 3 });

    expect(result.title).toContain('Graph Curation Sweep');
    expect(result.promptText).toContain('Consolidation Candidates');
    expect(result.promptText).toContain('src/utils/scanner.ts');
    expect(result.promptText).toContain('Promotion Candidates');
    expect(result.promptText).toContain('NixOS Dynamic Linker Invariant');
    expect(result.promptText).toContain('Orphan & Disconnected Memories');
    expect(result.promptText).toContain('Floating Lesson Without Targets');
    expect(result.promptText).toContain('Step-by-Step Curation Workflow');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from './config';
import { ContextManager } from './context';
import { getContextPath } from '../utils/paths';
import {
  exportBundle,
  importBundle,
  serializeBundleBuffer,
  parseBundleBuffer,
} from './transfer';

describe('Context & Full-Instance Export / Import (transfer.ts)', () => {
  let machineADir: string;
  let machineBDir: string;

  beforeEach(() => {
    machineADir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_transfer_machineA_'));
    machineBDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_transfer_machineB_'));
    process.env.STORMDRAIN_TEST_DIR = machineADir;
  });

  afterEach(() => {
    try {
      fs.rmSync(machineADir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(machineBDir, { recursive: true, force: true });
    } catch {}
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('exports a specific context and imports it on a new machine with --as and --bind', async () => {
    // Setup Machine A
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const cfgA = new ConfigManager();
    const oldRepoPath = path.join(machineADir, 'old_host_repo');
    fs.mkdirSync(oldRepoPath, { recursive: true });
    cfgA.addContext('engine-ctx', [oldRepoPath]);

    const ctxA = new ContextManager('engine-ctx');
    const m1 = ctxA.addMemory(
      'fact',
      'SIMD Alignment Invariant',
      'Buffers must be 64-byte aligned for AVX-512.',
      ['simd', 'invariant'],
      'manual',
      undefined,
      'src/core/simd.ts'
    );
    const m2 = ctxA.addMemory(
      'guide',
      'VTune Runbook',
      'Run vtune -collect hotspots.',
      ['profiling']
    );
    ctxA.addRelation(m2, m1, 'related_to');
    await ctxA.close();

    const bundle = exportBundle({ contexts: ['engine-ctx'] });
    expect(bundle.scope).toBe('context');
    expect(Object.keys(bundle.contexts)).toEqual(['engine-ctx']);
    expect(bundle.contexts['engine-ctx'].memories.length).toBe(2);

    // Switch to Machine B and import as "engine-renamed" bound to newRepoPath
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    const newRepoPath = path.join(machineBDir, 'new_server_repo');
    fs.mkdirSync(newRepoPath, { recursive: true });

    const importRes = await importBundle(bundle, {
      targetContextName: 'engine-renamed',
      bindPaths: [newRepoPath],
    });

    expect(importRes.totalAdded).toBe(2);
    expect(importRes.contexts[0].context).toBe('engine-renamed');
    expect(importRes.contexts[0].boundPaths).toContain(path.resolve(newRepoPath));

    // Verify memories, FTS search, and relations on Machine B
    const ctxB = new ContextManager('engine-renamed');
    try {
      const importedM1 = ctxB.getMemory(m1);
      expect(importedM1).not.toBeNull();
      expect(importedM1?.metadata.context).toBe('engine-renamed');
      expect(importedM1?.metadata.title).toBe('SIMD Alignment Invariant');

      const searchHits = ctxB.searchMemories('AVX-512', false);
      expect(searchHits.map(r => r.id)).toContain(m1);

      const rels = ctxB.getRelations(m2);
      expect(rels.outgoing).toEqual([{ target: m1, type: 'related_to' }]);
    } finally {
      await ctxB.close();
    }
  });

  it('exports the entire instance (--all) with Gzip compression and restores all contexts and settings on Machine B', async () => {
    // Machine A setup: _global + 2 project contexts + custom settings
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const cfgA = new ConfigManager();
    cfgA.addContext('proj-alpha');
    cfgA.addContext('proj-beta');
    cfgA.setActiveContext('proj-alpha');
    cfgA.updateSettings({
      readTool: { tokenBudget: 950 },
      graph: { consolidationThreshold: 5 },
    });

    const globalCtxA = new ContextManager('_global');
    const gId = globalCtxA.addMemory('fact', 'Global NixOS Rule', 'Use patchelf on NixOS.', ['nixos']);
    await globalCtxA.close();

    const alphaCtxA = new ContextManager('proj-alpha');
    const aId = alphaCtxA.addMemory('decision', 'Alpha Architecture', 'Use SQLite WAL mode.', ['sqlite']);
    await alphaCtxA.close();

    // Serialize with Gzip
    const fullBundle = exportBundle({ all: true });
    expect(fullBundle.scope).toBe('all');
    const gzippedBuf = serializeBundleBuffer(fullBundle, true);
    // Verify Gzip magic header (0x1f 0x8b)
    expect(gzippedBuf[0]).toBe(0x1f);
    expect(gzippedBuf[1]).toBe(0x8b);

    // Switch to Machine B, parse Gzipped buffer, and import
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    const parsedBundle = parseBundleBuffer(gzippedBuf);
    const res = await importBundle(parsedBundle);

    expect(res.scope).toBe('all');
    expect(res.settingsImported).toBe(true);
    expect(res.totalAdded).toBe(2);

    const cfgB = new ConfigManager();
    expect(cfgB.getActiveContext()).toBe('proj-alpha');
    expect(cfgB.getSettings().readTool.tokenBudget).toBe(950);
    expect(cfgB.getSettings().graph.consolidationThreshold).toBe(5);

    const globalCtxB = new ContextManager('_global');
    const alphaCtxB = new ContextManager('proj-alpha');
    try {
      expect(globalCtxB.getMemory(gId)?.metadata.title).toBe('Global NixOS Rule');
      expect(alphaCtxB.getMemory(aId)?.metadata.title).toBe('Alpha Architecture');
    } finally {
      await globalCtxB.close();
      await alphaCtxB.close();
    }
  });

  it('resolves conflicts according to strategy: merge (timestamp + tag/relation union), skip, and overwrite', async () => {
    // Machine A creates memory mem_shared1 at T1
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const ctxA = new ContextManager('_global');
    const sharedId = ctxA.addMemory(
      'fact',
      'Older Title From Machine A',
      'Older content from Machine A',
      ['tag-a'],
      'manual',
      'mem_shared1',
      'src/a.ts'
    );
    // Force older timestamp on Machine A
    const memA = ctxA.getMemory(sharedId)!;
    memA.metadata.updated = '2026-01-01T00:00:00.000Z';
    ctxA.saveMemory(memA, 'set older timestamp');
    await ctxA.close();

    const bundleFromA = exportBundle({ contexts: ['_global'] });

    // Machine B already has mem_shared1 with a NEWER timestamp T2 and different tag/relation
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    const ctxB = new ContextManager('_global');
    ctxB.addMemory(
      'fact',
      'Newer Title On Machine B',
      'Newer content on Machine B',
      ['tag-b'],
      'manual',
      'mem_shared1',
      'src/b.ts'
    );
    const memB = ctxB.getMemory(sharedId)!;
    memB.metadata.updated = '2026-06-01T00:00:00.000Z';
    ctxB.saveMemory(memB, 'set newer timestamp');
    await ctxB.close();

    // 1. Strategy: skip -> keeps Machine B untouched
    const skipRes = await importBundle(bundleFromA, { strategy: 'skip' });
    expect(skipRes.totalSkipped).toBe(1);
    expect(skipRes.totalUpdated).toBe(0);

    // 2. Strategy: merge -> Machine B's newer title/content wins, but tags ('tag-a' + 'tag-b') and relations are unioned
    const mergeRes = await importBundle(bundleFromA, { strategy: 'merge' });
    expect(mergeRes.totalUpdated).toBe(1);

    const ctxBAfterMerge = new ContextManager('_global');
    try {
      const merged = ctxBAfterMerge.getMemory(sharedId)!;
      expect(merged.metadata.title).toBe('Newer Title On Machine B');
      expect(merged.content).toBe('Newer content on Machine B');
      expect(merged.metadata.tags).toEqual(expect.arrayContaining(['tag-a', 'tag-b']));
      expect(merged.metadata.relations.map(r => r.target)).toEqual(
        expect.arrayContaining(['file_src_a_ts', 'file_src_b_ts'])
      );
    } finally {
      await ctxBAfterMerge.close();
    }

    // 3. Strategy: overwrite -> Machine A's version overwrites Machine B despite older timestamp
    const overwriteRes = await importBundle(bundleFromA, { strategy: 'overwrite' });
    expect(overwriteRes.totalUpdated).toBe(1);

    const ctxBAfterOverwrite = new ContextManager('_global');
    try {
      const overwritten = ctxBAfterOverwrite.getMemory(sharedId)!;
      expect(overwritten.metadata.title).toBe('Older Title From Machine A');
      expect(overwritten.metadata.tags).toEqual(['tag-a']);
    } finally {
      await ctxBAfterOverwrite.close();
    }
  });

  it('supports --no-codemaps (includeCodemaps: false) during export and import', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const ctxA = new ContextManager('_global');
    ctxA.addMemory('codemap', '[File] src/index.ts', 'File Node: src/index.ts', [], 'auto-scan', 'file_src_index_ts');
    const domainId = ctxA.addMemory('warning', 'Domain Gotcha', 'Important domain warning.');
    await ctxA.close();

    const bundleNoCodemaps = exportBundle({ contexts: ['_global'], includeCodemaps: false });
    expect(bundleNoCodemaps.contexts['_global'].memories.map(m => m.metadata.id)).toEqual([domainId]);
  });

  it('prevents path traversal in context names and ignores malformed memory IDs (Bug #1)', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineBDir;

    const maliciousContextBundle: any = {
      format: 'stormdrain-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'context',
      contexts: {
        '../escape_dir': {
          config: { paths: [] },
          memories: [],
        },
      },
    };

    await expect(importBundle(maliciousContextBundle)).rejects.toThrow(/Invalid context name/i);
    await expect(
      importBundle(
        {
          format: 'stormdrain-bundle',
          version: 1,
          exportedAt: new Date().toISOString(),
          scope: 'context',
          contexts: {
            valid_ctx: { config: { paths: [] }, memories: [] },
          },
        },
        { targetContextName: '../../outside' }
      )
    ).rejects.toThrow(/Invalid context name/i);

    // Malformed memory IDs ('..', '.', non-strings) should be skipped without escaping the context directory
    const dotIdBundle: any = {
      format: 'stormdrain-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'context',
      contexts: {
        safe_ctx: {
          config: { paths: [] },
          memories: [
            {
              metadata: {
                id: '..',
                title: 'Traversal Attempt',
                type: 'fact',
                context: 'safe_ctx',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                accessed: '2026-01-01T00:00:00.000Z',
                access_count: 1,
                confidence: 1,
                tags: [],
                relations: [],
              },
              content: 'Should be skipped.',
            },
            {
              metadata: {
                id: 'mem_valid1',
                title: 'Valid Memory',
                type: 'fact',
                context: 'safe_ctx',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                accessed: '2026-01-01T00:00:00.000Z',
                access_count: 1,
                confidence: 1,
                tags: [],
                relations: [],
              },
              content: 'Valid content.',
            },
          ],
        },
      },
    };

    const res = await importBundle(dotIdBundle);
    expect(res.totalAdded).toBe(1);
    expect(res.totalSkipped).toBe(1);
  });

  it('prevents zombie consolidated state during merge when micro-memories are consolidated or re-edited across machines (Bug #2)', async () => {
    // Machine A creates two micro-memories at T1
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const ctxA = new ContextManager('_global');
    const m1 = ctxA.addMemory('fact', 'Micro 1', 'Detail 1', ['perf'], 'manual', 'mem_micro1');
    const m2 = ctxA.addMemory('fact', 'Micro 2', 'Detail 2', ['perf'], 'manual', 'mem_micro2');
    const mem1A = ctxA.getMemory(m1)!;
    mem1A.metadata.updated = '2026-01-01T00:00:00.000Z';
    ctxA.saveMemory(mem1A, 'set T1');
    const mem2A = ctxA.getMemory(m2)!;
    mem2A.metadata.updated = '2026-01-01T00:00:00.000Z';
    ctxA.saveMemory(mem2A, 'set T1');
    await ctxA.close();

    const oldUnconsolidatedBundleFromA = exportBundle({ contexts: ['_global'] });

    // Machine B imports the T1 bundle, then consolidates mem_micro1 + mem_micro2 into a guide at T2 (now)
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    await importBundle(oldUnconsolidatedBundleFromA);
    const ctxB = new ContextManager('_global');
    const { consolidatedId: superId } = ctxB.consolidateNeighborhood(undefined, {
      memory_ids: [m1, m2],
      title: 'Consolidated Perf Guide',
    });
    expect(superId).toBeTruthy();
    await ctxB.close();

    // Case 2a: Re-importing Machine A's OLD unconsolidated bundle into Machine B must NOT un-consolidate mem_micro1
    await importBundle(oldUnconsolidatedBundleFromA, { strategy: 'merge' });
    const ctxBCheck1 = new ContextManager('_global');
    try {
      const afterOldMerge = ctxBCheck1.getMemory(m1)!;
      expect(afterOldMerge.metadata.superseded_by).toBe(superId);
      expect(afterOldMerge.metadata.tags).toContain('consolidated');
    } finally {
      await ctxBCheck1.close();
    }

    // Case 2b: Machine A edits mem_micro1 at T3 (future timestamp > T2) as an active unconsolidated memory
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const ctxALate = new ContextManager('_global');
    const mem1Late = ctxALate.getMemory(m1)!;
    mem1Late.content = 'Updated active content on Machine A after consolidation';
    mem1Late.metadata.updated = '2099-01-01T00:00:00.000Z';
    ctxALate.saveMemory(mem1Late, 'late edit at T3');
    await ctxALate.close();

    const newerActiveBundleFromA = exportBundle({ contexts: ['_global'] });

    // Importing Machine A's T3 bundle into Machine B: T3 wins and must NOT carry a zombie 'consolidated' tag
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    await importBundle(newerActiveBundleFromA, { strategy: 'merge' });
    const ctxBCheck2 = new ContextManager('_global');
    try {
      const afterNewerMerge = ctxBCheck2.getMemory(m1)!;
      expect(afterNewerMerge.content).toBe('Updated active content on Machine A after consolidation');
      expect(afterNewerMerge.metadata.superseded_by).toBeNull();
      expect(afterNewerMerge.metadata.tags).not.toContain('consolidated');
    } finally {
      await ctxBCheck2.close();
    }
  });

  it('commits imported files to Git and auto-scans bound workspace files on --bind (Bugs #3 & #4)', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const ctxA = new ContextManager('_global');
    const domainId = ctxA.addMemory(
      'fact',
      'Core Invariant',
      'Must hold for src/app.ts.',
      ['core'],
      'manual',
      undefined,
      'src/app.ts'
    );
    await ctxA.close();

    // Export without codemaps
    const bundle = exportBundle({ contexts: ['_global'], includeCodemaps: false });

    // Prepare a real source workspace on Machine B containing src/app.ts
    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    const workspaceB = path.join(machineBDir, 'workspace_b');
    fs.mkdirSync(path.join(workspaceB, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceB, 'src', 'app.ts'), 'export const x = 42;\n', 'utf8');

    const res = await importBundle(bundle, {
      targetContextName: 'bound-ctx',
      bindPaths: [workspaceB],
    });

    // Verify auto-scan populated codemaps for bound workspace
    expect(res.contexts[0].scannedFiles).toBeGreaterThanOrEqual(1);

    const ctxB = new ContextManager('bound-ctx');
    try {
      // Codemap node file_src_app_ts should exist now thanks to auto-scan
      expect(ctxB.getMemory('file_src_app_ts')).not.toBeNull();
      // Multi-hop recall for src/app.ts should return our imported domain memory
      const recalled = ctxB.recallMultiHop('src/app.ts');
      expect(recalled.memories.map(r => r.id)).toContain(domainId);
      // Git repository inside context directory should have committed the imported .md files
      const ctxDir = getContextPath('bound-ctx');
      expect(fs.existsSync(path.join(ctxDir, '.git'))).toBe(true);
    } finally {
      await ctxB.close();
    }
  });

  it('preserves parent context relationships even when child sorts alphabetically before parent (Bug #5)', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const cfgA = new ConfigManager();
    cfgA.addContext('z-parent-ctx');
    cfgA.addContext('a-child-ctx', [], 'z-parent-ctx');

    // Construct bundle where 'a-child-ctx' appears before 'z-parent-ctx'
    const bundle = exportBundle({ contexts: ['a-child-ctx', 'z-parent-ctx'] });
    expect(Object.keys(bundle.contexts)).toEqual(['a-child-ctx', 'z-parent-ctx']);

    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    await importBundle(bundle);

    const cfgB = new ConfigManager();
    expect(cfgB.getContexts()['a-child-ctx']?.parent).toBe('z-parent-ctx');
  });

  it('rejects --bind when importing multiple contexts and preserves min(created) / max(accessed) on merge (Bugs #7 & #8)', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineADir;
    const cfgA = new ConfigManager();
    cfgA.addContext('ctx-one');
    cfgA.addContext('ctx-two');
    const multiBundle = exportBundle({ contexts: ['ctx-one', 'ctx-two'] });

    process.env.STORMDRAIN_TEST_DIR = machineBDir;
    await expect(
      importBundle(multiBundle, { bindPaths: [machineBDir] })
    ).rejects.toThrow(/Cannot use "--bind <path>" when importing multiple contexts/i);

    // Also verify min(created), max(accessed), max(access_count), and is_canonical preservation during merge
    const ctxB = new ContextManager('_global');
    ctxB.addMemory('fact', 'Local Fact', 'Local body', [], 'manual', 'mem_meta_merge');
    const localMem = ctxB.getMemory('mem_meta_merge')!;
    localMem.metadata.created = '2026-05-01T00:00:00.000Z';
    localMem.metadata.updated = '2026-06-01T00:00:00.000Z';
    localMem.metadata.accessed = '2026-06-01T00:00:00.000Z';
    localMem.metadata.access_count = 3;
    localMem.metadata.is_canonical = false;
    ctxB.saveMemory(localMem, 'setup local');
    await ctxB.close();

    const incomingBundle: any = {
      format: 'stormdrain-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'context',
      contexts: {
        _global: {
          config: { paths: [] },
          memories: [
            {
              metadata: {
                id: 'mem_meta_merge',
                title: 'Incoming Older Edit With Earlier Created & Higher Access',
                type: 'fact',
                context: '_global',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-02-01T00:00:00.000Z',
                accessed: '2026-08-01T00:00:00.000Z',
                access_count: 12,
                confidence: 1,
                tags: [],
                relations: [],
                is_canonical: true,
              },
              content: 'Incoming body',
            },
          ],
        },
      },
    };

    await importBundle(incomingBundle, { strategy: 'merge' });
    const ctxBVerify = new ContextManager('_global');
    try {
      const merged = ctxBVerify.getMemory('mem_meta_merge')!;
      expect(merged.metadata.created).toBe('2026-01-01T00:00:00.000Z');
      expect(merged.metadata.accessed).toBe('2026-08-01T00:00:00.000Z');
      expect(merged.metadata.access_count).toBe(12);
      expect(merged.metadata.is_canonical).toBe(true);
    } finally {
      await ctxBVerify.close();
    }
  });

  it('automatically heals dangling superseded_by references on partial bundle imports', async () => {
    process.env.STORMDRAIN_TEST_DIR = machineBDir;

    // Bundle contains a memory that claims to be superseded by a super-memory that does NOT exist in the bundle
    const danglingBundle: any = {
      format: 'stormdrain-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'context',
      contexts: {
        _global: {
          config: { paths: [] },
          memories: [
            {
              metadata: {
                id: 'mem_broken_super',
                title: 'Orphan Micro-Memory',
                type: 'fact',
                context: '_global',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                accessed: '2026-01-01T00:00:00.000Z',
                access_count: 1,
                confidence: 0.8,
                tags: ['consolidated', 'perf'],
                relations: [],
                superseded_by: 'mem_nonexistent_super',
              },
              content: 'Content that should not stay hidden forever.',
            },
          ],
        },
      },
    };

    const res = await importBundle(danglingBundle);
    expect(res.totalAdded).toBe(1);

    const ctx = new ContextManager('_global');
    try {
      const healed = ctx.getMemory('mem_broken_super')!;
      expect(healed).not.toBeNull();
      // superseded_by must be cleared and 'consolidated' tag removed
      expect(healed.metadata.superseded_by).toBeNull();
      expect(healed.metadata.tags).not.toContain('consolidated');
      expect(healed.metadata.tags).toContain('perf');

      // It must now appear in default listMemoriesWithStats as an active memory
      const list = ctx.listMemoriesWithStats();
      expect(list.map(m => m.id)).toContain('mem_broken_super');
    } finally {
      await ctx.close();
    }
  });
});

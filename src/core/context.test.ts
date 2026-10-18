import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';

describe('ContextManager', () => {
  let testDir: string;
  let config: ConfigManager;
  let ctx: ContextManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_test_${Date.now()}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
    
    config = new ConfigManager();
    config.addContext('test-context');
    ctx = new ContextManager('test-context');
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should add a memory and sync it to db', () => {
    const id = ctx.addMemory('fact', 'A test fact', 'This is content', ['tag1']);
    expect(id).toBeDefined();

    // Fetch memory
    const mem = ctx.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem?.metadata.title).toBe('A test fact');
    expect(mem?.metadata.tags).toContain('tag1');
    expect(mem?.metadata.type).toBe('fact');

    // Test search
    const results = ctx.searchMemories('content');
    expect(results.length).toBeGreaterThan(0);
    expect((results[0] as any).id).toBe(id);
  });

  it('should reject non-canonical memory types with an informative error', () => {
    expect(() => {
      ctx.addMemory('invariant' as any, 'Strict test', 'content');
    }).toThrow('Invalid memory type "invariant"');

    expect(() => {
      ctx.addMemory('lesson' as any, 'Strict test', 'content');
    }).toThrow('Invalid memory type "lesson"');
  });

  it('should update a memory and search it via FTS', () => {
    const id = ctx.addMemory('warning', 'Original', 'content 1');
    
    ctx.updateMemory(id, 'content updated', 'Updated Title', ['new-tag']);
    
    const mem = ctx.getMemory(id);
    expect(mem?.metadata.title).toBe('Updated Title');
    expect(mem?.metadata.tags).toContain('new-tag');
    expect(mem?.content).toBe('content updated');

    // Verify FTS update
    const results = ctx.searchMemories('updated');
    expect(results.length).toBe(1);
    expect((results[0] as any).id).toBe(id);
  });

  it('should correctly delete a memory', () => {
    const id = ctx.addMemory('warning', 'To be deleted', 'content');
    expect(ctx.getMemory(id)).not.toBeNull();
    
    ctx.deleteMemory(id);
    expect(ctx.getMemory(id)).toBeNull();
    
    const results = ctx.searchMemories('deleted');
    expect(results.length).toBe(0);
  });

  it('should correctly recall top memories', () => {
    const id1 = ctx.addMemory('fact', 'Memory 1', 'first');
    const id2 = ctx.addMemory('fact', 'Memory 2', 'second');
    
    // Simulate access to id2
    ctx.markAccessed(id2);
    ctx.markAccessed(id2);
    
    const top = ctx.recallTopMemories(5);
    expect(top.length).toBe(2);
    
    // id2 should be first because of access boost
    expect((top[0] as any).id).toBe(id2);
    expect((top[1] as any).id).toBe(id1);
  });

  it('should prune orphan codemap vertices that do not exist in workspace', () => {
    const wsDir = path.join(testDir, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'active.ts'), 'export const a = 1;', 'utf8');

    // Sync file graph creates active.ts vertex
    ctx.syncFileGraph(wsDir);
    expect(ctx.getMemory('file_active_ts')).not.toBeNull();

    // Manually add an orphan codemap for a file that does not exist in wsDir
    const orphanId = 'file_foreign_repo_bad_ts';
    ctx.addMemory('codemap', '[File] foreign/repo/bad.ts', 'File Node: `foreign/repo/bad.ts`', [], 'auto-scan', orphanId);
    expect(ctx.getMemory(orphanId)).not.toBeNull();

    // Run prune
    const res = ctx.pruneOrphanCodemaps([wsDir]);
    expect(res.prunedCount).toBe(1);
    expect(ctx.getMemory(orphanId)).toBeNull();
    expect(ctx.getMemory('file_active_ts')).not.toBeNull();
  });

  it('should idempotently converge legacy database rows on startup and preserve invariant tags', async () => {
    const legacyCtxName = 'legacy-migration-test';
    const legacyCtx = new ContextManager(legacyCtxName);
    const db = legacyCtx.getDb();

    // Directly insert legacy rows bypassing addMemory validation
    db.prepare(`
      INSERT INTO memories (id, type, title, context, confidence, created, updated, accessed, access_count, source)
      VALUES 
        ('mem_leg_1', 'invariant', 'Old Invariant Rule', '${legacyCtxName}', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'manual'),
        ('mem_leg_2', 'lesson', 'Old Lesson Gotcha', '${legacyCtxName}', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'manual'),
        ('mem_leg_3', 'pattern', 'Old Pattern Model', '${legacyCtxName}', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'manual'),
        ('mem_leg_4', 'sequence', 'Old Sequence Workflow', '${legacyCtxName}', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'manual')
    `).run();

    await legacyCtx.close();

    // Reopen context (triggers initSchema convergence)
    const reopenedCtx = new ContextManager(legacyCtxName);
    try {
      const mem1 = reopenedCtx.getDb().prepare("SELECT * FROM memories WHERE id = 'mem_leg_1'").get() as any;
      const mem2 = reopenedCtx.getDb().prepare("SELECT * FROM memories WHERE id = 'mem_leg_2'").get() as any;
      const mem3 = reopenedCtx.getDb().prepare("SELECT * FROM memories WHERE id = 'mem_leg_3'").get() as any;
      const mem4 = reopenedCtx.getDb().prepare("SELECT * FROM memories WHERE id = 'mem_leg_4'").get() as any;

      expect(mem1.type).toBe('fact');
      expect(mem2.type).toBe('warning');
      expect(mem3.type).toBe('concept');
      expect(mem4.type).toBe('guide');

      // Verify tag was preserved for invariant
      const tags1 = reopenedCtx.getDb().prepare("SELECT tag FROM tags WHERE memory_id = 'mem_leg_1'").all() as any[];
      expect(tags1.map(t => t.tag)).toContain('invariant');

      // Verify search by canonical type works in SQLite
      const factResults = reopenedCtx.searchMemories('', false, { type: 'fact' });
      expect(factResults.some(r => r.id === 'mem_leg_1')).toBe(true);

      // Verify search by legacy type alias also works
      const legacySearch = reopenedCtx.searchMemories('', false, { type: 'invariant' as any });
      expect(legacySearch.some(r => r.id === 'mem_leg_1')).toBe(true);
    } finally {
      await reopenedCtx.close();
    }
  });

  it('should strictly isolate getWorkspaceRoots and never append foreign CWD or home root', () => {
    const boundPath = path.join(testDir, 'isolated-proj');
    fs.mkdirSync(boundPath, { recursive: true });
    config.bindPathToContext('test-context', boundPath);
    
    // Clear cache to pick up newly bound path
    ctx.clearCache();
    const roots = ctx.getWorkspaceRoots();

    expect(roots).toContain(path.resolve(boundPath));
    expect(roots).not.toContain(path.resolve(os.homedir()));
    expect(roots.length).toBe(1);
  });

  it('Bug #1 (Consolidation Paradox): file-less consolidation does not inflate incoming_count from superseded children', () => {
    const m1 = ctx.addMemory('fact', 'Orphan Perf Fact 1', 'Cache line size is 64 bytes.', ['perf']);
    const m2 = ctx.addMemory('fact', 'Orphan Perf Fact 2', 'Avoid false sharing across threads.', ['perf']);

    const { consolidatedId, mergedCount } = ctx.consolidateNeighborhood(undefined, {
      memory_ids: [m1, m2],
      title: 'CPU Cache Performance Guide'
    });
    expect(mergedCount).toBe(2);
    expect(consolidatedId).toMatch(/^mem_/);

    // The superseded children have part_of -> consolidatedId, but those must NOT count as active incoming connections
    const list = ctx.listMemoriesWithStats();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(consolidatedId);
    expect(list[0].incoming_count).toBe(0);
    expect(list[0].outgoing_count).toBe(0);
    expect(list[0].total_connections).toBe(0);

    // Must still appear in orphansOnly until linked to a file or active concept
    const orphans = ctx.listMemoriesWithStats({ orphansOnly: true });
    expect(orphans.map(o => o.id)).toContain(consolidatedId);
  });

  it('Bug #2 (Non-File Memory Discovery): recallTopMemories and searchMemories exclude codemap and superseded nodes and populate content_snippet', () => {
    // Add 5 codemap file nodes with confidence 1.0
    for (let i = 0; i < 5; i++) {
      ctx.addMemory('codemap', `[File] src/file${i}.ts`, `File Node: src/file${i}.ts`, [], 'auto-scan', `file_src_file${i}_ts`);
    }

    // Add 2 micro-memories and consolidate them so they become superseded
    const m1 = ctx.addMemory('fact', 'Superseded Micro 1', 'UniqueTokenAlpha in micro 1');
    const m2 = ctx.addMemory('fact', 'Superseded Micro 2', 'UniqueTokenAlpha in micro 2');
    const { consolidatedId } = ctx.consolidateNeighborhood(undefined, {
      memory_ids: [m1, m2],
      title: 'Workspace VTune Guide'
    });

    // recallTopMemories must NOT return any codemap or superseded micro-memory
    const top = ctx.recallTopMemories(5);
    expect(top.length).toBe(1);
    expect(top[0].id).toBe(consolidatedId);
    expect(top[0].type).toBe('guide');
    expect(top[0].content_snippet).toContain('UniqueTokenAlpha');

    // searchMemories must also exclude codemaps and superseded micro-memories
    const searchRes = ctx.searchMemories('UniqueTokenAlpha', false);
    expect(searchRes.map(r => r.id)).toEqual([consolidatedId]);

    const codemapSearch = ctx.searchMemories('File Node', false);
    expect(codemapSearch.length).toBe(0);
  });

  it('Bug #3 (Self-Loop Guard): addRelation rejects self-loops', () => {
    const id = ctx.addMemory('concept', 'Domain Model', 'Core domain concept');
    const added = ctx.addRelation(id, id, 'related_to');
    expect(added).toBe(false);
    expect(ctx.getMemory(id)?.metadata.relations).toEqual([]);
  });

  it('Bug #4 (Consolidation Cycles, Mixed Attached+Orphan, Positional IDs & Heading): handles intra-batch edges and mixed orphans cleanly', () => {
    // 4a. Intra-batch edge m1 -> m2 must NOT be copied onto consolidatedId (would create a cycle)
    const m1 = ctx.addMemory('fact', 'Batch Node A', 'First node');
    const m2 = ctx.addMemory('fact', 'Batch Node B', 'Second node');
    ctx.addRelation(m1, m2, 'related_to');

    // Positional disambiguation: passing m1 as targetFileOrId and [m2] as memory_ids
    const res1 = ctx.consolidateNeighborhood(m1, [m2]);
    expect(res1.mergedCount).toBe(2);
    const guide1 = ctx.getMemory(res1.consolidatedId);
    expect(guide1).not.toBeNull();
    // Guide must not have an outgoing relation to m1 or m2
    expect(guide1!.metadata.relations).toEqual([]);
    // Heading must not double-prefix "Consolidated Guide for Consolidated Guide:"
    expect(guide1!.content).not.toContain('Consolidated Guide for Consolidated Guide:');

    // 4b. Mixed 1 attached memory + 1 unattached orphan memory consolidated onto target file
    const mAttached = ctx.addMemory('warning', 'Attached Warning', 'Anchored to config.ts', [], 'manual', undefined, 'src/core/config.ts');
    const mOrphan = ctx.addMemory('fact', 'Unattached Config Fact', 'Related config invariant that forgot target');

    const res2 = ctx.consolidateNeighborhood('src/core/config.ts', {
      memory_ids: [mAttached, mOrphan],
      title: 'Unified Config Guide'
    });
    expect(res2.mergedCount).toBe(2);
    const guide2 = ctx.getMemory(res2.consolidatedId);
    expect(guide2?.metadata.relations.some(r => r.target === 'file_src_core_config_ts')).toBe(true);
  });

  it('Bug #5 (Path Tokenization in suggestCandidateTargets & Tag Cluster Candidates): splits file path segments for FTS and detects disconnected tag clusters', () => {
    // Existing memory with "profiler" in title/content
    const existingId = ctx.addMemory('concept', 'VTune Profiler Architecture', 'Hardware performance counter sampling architecture.');

    // New orphan memory referencing a slash/dot path "src/utils/profiler.ts"
    const orphanId = ctx.addMemory('fact', 'Sampling Interval Rule', 'Check src/utils/profiler.ts for 10ms interval.');
    const suggestions = ctx.suggestCandidateTargets(orphanId, 3);
    expect(suggestions.map(s => s.id)).toContain(existingId);

    // 3 disconnected memories sharing #vtune should surface as a tag cluster in findConsolidationCandidates
    ctx.addMemory('fact', 'VTune Note 1', 'First vtune note', ['vtune']);
    ctx.addMemory('fact', 'VTune Note 2', 'Second vtune note', ['vtune']);
    ctx.addMemory('guide', 'VTune Note 3', 'Third vtune note', ['vtune']);

    const candidates = ctx.findConsolidationCandidates(3);
    const vtuneCluster = candidates.find(c => c.target === '#vtune');
    expect(vtuneCluster).toBeDefined();
    expect(vtuneCluster?.memoryCount).toBe(3);
  });
});



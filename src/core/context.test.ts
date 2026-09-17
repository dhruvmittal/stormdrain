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
});


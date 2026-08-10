import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { makeFileVertexId } from '../utils/fileGraphScanner';

describe('Multi-Hop Topological Recall Engine', () => {
  let testDir: string;
  let ctx: ContextManager;
  const contextName = 'test_multihop';

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain-multihop-test-'));
    process.env.STORMDRAIN_TEST_DIR = testDir;
    ctx = new ContextManager(contextName);
  });

  afterEach(async () => {
    await ctx.close();
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('should return empty results gracefully for non-existent target files', () => {
    const res = ctx.recallMultiHop('src/non_existent_file.ts');
    expect(res.direct).toEqual([]);
    expect(res.upstream).toEqual([]);
    expect(res.downstream).toEqual([]);
    expect(res.all).toEqual([]);
  });

  it('should recall direct memories with depth 0 and direct direction', () => {
    const fileA = 'src/core/context.ts';
    const idA = makeFileVertexId(fileA);

    // Add a file vertex
    ctx.addMemory('codemap', fileA, 'codemap content', ['file-vertex'], 'indexer', idA);

    // Add direct warning to fileA
    const mem1 = ctx.addMemory('warning', 'Direct Invariant Warning', 'Must use WAL mode', ['db', 'wal'], 'manual', undefined, fileA);

    const res = ctx.recallMultiHop(fileA);
    expect(res.direct.length).toBe(1);
    expect(res.direct[0].id).toBe(mem1);
    expect(res.direct[0].depth).toBe(0);
    expect(res.direct[0].direction).toBe('direct');
    expect(res.direct[0].relevanceScore).toBeGreaterThan(0);
    expect(res.all.length).toBe(1);
  });

  it('should traverse multi-hop forward dependencies and backward callers with asymmetric weighting', () => {
    // Topology:
    // Consumer (src/mcp/index.ts) -> Target (src/core/context.ts) -> Dep (src/core/git.ts) -> SubDep (src/core/config.ts)
    const fileTarget = 'src/core/context.ts';
    const fileConsumer = 'src/mcp/index.ts';
    const fileDep = 'src/core/git.ts';
    const fileSubDep = 'src/core/config.ts';

    const idTarget = makeFileVertexId(fileTarget);
    const idConsumer = makeFileVertexId(fileConsumer);
    const idDep = makeFileVertexId(fileDep);
    const idSubDep = makeFileVertexId(fileSubDep);

    // Register codemap vertices
    ctx.addMemory('codemap', fileTarget, 'target', ['file-vertex'], 'indexer', idTarget);
    ctx.addMemory('codemap', fileConsumer, 'consumer', ['file-vertex'], 'indexer', idConsumer);
    ctx.addMemory('codemap', fileDep, 'dep', ['file-vertex'], 'indexer', idDep);
    ctx.addMemory('codemap', fileSubDep, 'subdep', ['file-vertex'], 'indexer', idSubDep);

    // Register import relations
    const db = ctx.getDb();
    db.prepare(`INSERT INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(idConsumer, idTarget);
    db.prepare(`INSERT INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(idTarget, idDep);
    db.prepare(`INSERT INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(idDep, idSubDep);

    // Attach domain memories
    const memDirect = ctx.addMemory('warning', 'Target Direct Rule', 'Context rule', ['core'], 'manual', undefined, fileTarget);
    const memConsumer = ctx.addMemory('pattern', 'MCP Consumer Protocol', 'MCP caller constraint', ['mcp'], 'manual', undefined, fileConsumer);
    const memDep = ctx.addMemory('lesson', 'Git Subsystem Lesson', 'Git lock handling', ['git'], 'manual', undefined, fileDep);
    const memSubDep = ctx.addMemory('fact', 'Config Defaults', 'Config paths invariant', ['config'], 'manual', undefined, fileSubDep);

    const res = ctx.recallMultiHop(fileTarget, { maxDepth: 3, cumulativeThreshold: 1.0 });

    // Direct
    expect(res.direct.some(m => m.id === memDirect)).toBe(true);

    // Upstream
    const upstream = res.upstream.find(m => m.id === memConsumer);
    expect(upstream).toBeDefined();
    expect(upstream?.depth).toBe(1);
    expect(upstream?.direction).toBe('upstream_caller');

    // Downstream
    const dep = res.downstream.find(m => m.id === memDep);
    expect(dep).toBeDefined();
    expect(dep?.depth).toBe(1);
    expect(dep?.direction).toBe('downstream_dependency');

    const subDep = res.downstream.find(m => m.id === memSubDep);
    expect(subDep).toBeDefined();
    expect(subDep?.depth).toBe(2);
    expect(subDep?.direction).toBe('downstream_dependency');

    // Hop decay verification: Hop 1 should score higher than Hop 2 for identical confidence
    if (dep && subDep) {
      expect(dep.relevanceScore).toBeGreaterThan(subDep.relevanceScore);
    }
  });

  it('should enforce the Consolidation Shield and suppress consolidated micro-memories', () => {
    const file = 'src/core/storage.ts';
    const fileId = makeFileVertexId(file);
    ctx.addMemory('codemap', file, 'storage codemap', ['file-vertex'], 'indexer', fileId);

    // Add 3 micro-memories
    const m1 = ctx.addMemory('fact', 'Micro Fact 1', 'Detail 1', ['tag1'], 'manual', undefined, file);
    const m2 = ctx.addMemory('fact', 'Micro Fact 2', 'Detail 2', ['tag2'], 'manual', undefined, file);
    const m3 = ctx.addMemory('fact', 'Micro Fact 3', 'Detail 3', ['tag3'], 'manual', undefined, file);

    // Before consolidation: all 3 appear
    const beforeConsolidation = ctx.recallMultiHop(file);
    expect(beforeConsolidation.direct.length).toBe(3);

    // Consolidate
    const { consolidatedId, mergedCount } = ctx.consolidateNeighborhood(file);
    expect(mergedCount).toBe(3);
    expect(consolidatedId).toBeTruthy();

    // After consolidation: only the consolidated guide appears, micro-memories are shielded
    const afterConsolidation = ctx.recallMultiHop(file);
    expect(afterConsolidation.direct.length).toBe(1);
    expect(afterConsolidation.direct[0].id).toBe(consolidatedId);
    expect(afterConsolidation.direct[0].type).toBe('guide');
    expect(afterConsolidation.direct[0].tags).toContain('consolidated-guide');

    // Ensure micro memories m1, m2, m3 were suppressed
    const recalledIds = afterConsolidation.all.map(m => m.id);
    expect(recalledIds).not.toContain(m1);
    expect(recalledIds).not.toContain(m2);
    expect(recalledIds).not.toContain(m3);
  });

  it('should support starting multi-hop recall from a memory ID directly', () => {
    const file = 'src/utils/scanner.ts';
    const fileId = makeFileVertexId(file);
    ctx.addMemory('codemap', file, 'scanner', ['file-vertex'], 'indexer', fileId);

    const memId = ctx.addMemory('pattern', 'Scanner Regex Pattern', 'Regex optimization', ['ast'], 'manual', undefined, file);

    const res = ctx.recallMultiHop(memId);
    expect(res.direct.length).toBe(1);
    expect(res.direct[0].id).toBe(memId);
  });

  it('should maintain mass conservation and prevent sink explosions on high-degree sink nodes', () => {
    const fileSink = 'src/utils/logger.ts';
    const idSink = makeFileVertexId(fileSink);
    ctx.addMemory('codemap', fileSink, 'logger', ['file-vertex'], 'indexer', idSink);

    const db = ctx.getDb();
    // Simulate 20 files importing logger.ts (high in-degree sink)
    for (let i = 0; i < 20; i++) {
      const callerFile = `src/module_${i}.ts`;
      const callerId = makeFileVertexId(callerFile);
      ctx.addMemory('codemap', callerFile, `module ${i}`, ['file-vertex'], 'indexer', callerId);
      db.prepare(`INSERT INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(callerId, idSink);
    }

    // Call recall on a single module
    const target = 'src/module_0.ts';
    const memTarget = ctx.addMemory('warning', 'Module 0 Invariant', 'Module 0 detail', ['mod0'], 'manual', undefined, target);

    const res = ctx.recallMultiHop(target, { maxDepth: 2, cumulativeThreshold: 0.85 });
    expect(res.direct.length).toBe(1);
    expect(res.direct[0].id).toBe(memTarget);

    // Verify it does not blow up into all 20 unrelated modules
    expect(res.all.length).toBeLessThan(10);
  });

  it('should ensure recallGraph passes through to recallMultiHop cleanly', () => {
    const file = 'src/core/engine.ts';
    const fileId = makeFileVertexId(file);
    ctx.addMemory('codemap', file, 'engine', ['file-vertex'], 'indexer', fileId);

    const mem = ctx.addMemory('warning', 'Engine Warning', 'Clean shutdown required', ['engine'], 'manual', undefined, file);

    const results = ctx.recallGraph(file, 2);
    expect(results.length).toBe(2); // 1 file vertex codemap + 1 attached domain memory
    expect(results.some(r => r.id === mem)).toBe(true);
    expect(results.some(r => r.id === fileId)).toBe(true);

    const multiHop = ctx.recallMultiHop(file);
    expect(multiHop.direct.length).toBe(1);
    expect(multiHop.direct[0].id).toBe(mem);
  });
});

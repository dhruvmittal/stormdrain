import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';

describe('Context & Graph Resilience Tests', () => {
  let tempDir: string;
  let homeDir: string;
  let ctx: ContextManager;
  let config: ConfigManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-resilience-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-home-resilience-'));
    
    process.env.HOME = homeDir;
    const ctxName = `resilience-ctx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    config = new ConfigManager();
    config.addContext(ctxName, [tempDir]);
    config.setActiveContext(ctxName);

    ctx = new ContextManager(ctxName);
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  describe('Search Sanitization & Query Robustness', () => {
    it('should handle empty, whitespace-only, and special regex characters gracefully', () => {
      ctx.addMemory('fact', 'Architecture note', 'SQLite backing store with FTS5 search');

      // Empty and whitespace queries should safely return empty array
      expect(ctx.searchMemories('')).toEqual([]);
      expect(ctx.searchMemories('   \t\n  ')).toEqual([]);

      // Special characters should be sanitized and not crash FTS5 parser
      const resSpecial = ctx.searchMemories('SQLite*?[]()/"\' backing');
      expect(resSpecial.length).toBeGreaterThanOrEqual(1);

      // Non-matching garbage query
      const resGarbage = ctx.searchMemories('nonexistenttermXYZ123');
      expect(resGarbage).toEqual([]);
    });
  });

  describe('Graph Traversal & Cycle Resilience', () => {
    it('should return empty results when querying a non-existent target node', () => {
      const results = ctx.recallGraph('non_existent_file.ts', 2);
      expect(results).toEqual([]);
    });

    it('should handle circular dependencies without infinite recursion', () => {
      // Simulate file A importing file B and file B importing file A
      const fileA = path.join(tempDir, 'module_a.ts');
      const fileB = path.join(tempDir, 'module_b.ts');

      fs.writeFileSync(fileA, 'import "./module_b";\nexport const a = 1;');
      fs.writeFileSync(fileB, 'import "./module_a";\nexport const b = 2;');

      ctx.syncFileGraph(tempDir);

      // Attach a warning memory to module_a.ts
      ctx.addMemory('warning', 'Circular Ref Warning', 'Careful with circular evaluation.', ['cycle'], 'manual', undefined, 'module_a.ts');

      // Query graph starting from module_b.ts
      const results = ctx.recallGraph('module_b.ts', 3);
      expect(results.length).toBeGreaterThan(0);

      // Verify no duplicates in traversal path
      const ids = results.map(r => r.id);
      const uniqueIds = Array.from(new Set(ids));
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('should respect maxDepth boundaries in recallGraph', () => {
      const fileA = path.join(tempDir, 'layer1.ts');
      const fileB = path.join(tempDir, 'layer2.ts');
      const fileC = path.join(tempDir, 'layer3.ts');

      fs.writeFileSync(fileA, 'import { layer2 } from "./layer2";\nexport const l1 = 1;');
      fs.writeFileSync(fileB, 'import { layer3 } from "./layer3";\nexport const l2 = 2;');
      fs.writeFileSync(fileC, 'export const bottom = true;');

      ctx.syncFileGraph(tempDir);

      // Depth 0 should return only layer1
      const depth0 = ctx.recallGraph('layer1.ts', 0);
      expect(depth0.length).toBe(1);

      // Depth 1 should return at least layer1 and layer2
      const depth1 = ctx.recallGraph('layer1.ts', 1);
      expect(depth1.length).toBeGreaterThanOrEqual(2);

      // Depth 2 should return layer1, layer2, and layer3 (more than depth 1)
      const depth2 = ctx.recallGraph('layer1.ts', 2);
      expect(depth2.length).toBeGreaterThanOrEqual(3);
      expect(depth2.length).toBeGreaterThan(depth1.length);
    });
  });

  describe('Memory Decay Bounds & Idempotency', () => {
    it('should not decay confidence if file hash remains unchanged', () => {
      const srcFile = path.join(tempDir, 'stable.ts');
      fs.writeFileSync(srcFile, 'export const version = 1.0;');

      ctx.syncFileGraph(tempDir);

      const memId = ctx.addMemory('warning', 'Stable Warning', 'A stable warning', ['stable'], 'manual', undefined, 'stable.ts');
      const before = ctx.getMemory(memId);
      expect(before?.metadata.confidence).toBe(1.0);

      // Re-scan without file changes
      const scanRes = ctx.syncFileGraph(tempDir);
      expect(scanRes.decayedCount).toBe(0);

      const after = ctx.getMemory(memId);
      expect(after?.metadata.confidence).toBe(1.0);
      expect(after?.metadata.tags).not.toContain('stale');
    });

    it('should respect minimum confidence decay floor (0.3) after repeated modifications', () => {
      const srcFile = path.join(tempDir, 'evolving.ts');
      fs.writeFileSync(srcFile, 'export const state = 0;');
      ctx.syncFileGraph(tempDir);

      const memId = ctx.addMemory('warning', 'Evolving Warning', 'Notice on evolving code', ['ev'], 'manual', undefined, 'evolving.ts');

      // Trigger 10 successive modifications
      for (let i = 1; i <= 10; i++) {
        fs.writeFileSync(srcFile, `export const state = ${i};`);
        ctx.syncFileGraph(tempDir);
      }

      const mem = ctx.getMemory(memId);
      expect(mem?.metadata.confidence).toBeGreaterThanOrEqual(0.3);
      // Ensure 'stale' tag is not duplicated multiple times
      const staleCount = mem?.metadata.tags.filter(t => t === 'stale').length;
      expect(staleCount).toBe(1);
    });

    it('should cap confidence at 1.0 when markAccessed is called', () => {
      const memId = ctx.addMemory('fact', 'Capped Memory', 'Testing upper boundary');
      const mem = ctx.getMemory(memId);
      if (mem) {
        mem.metadata.confidence = 0.98;
        // markAccessed increases by 0.05
        ctx.markAccessed(memId);
        const updated = ctx.getMemory(memId);
        expect(updated?.metadata.confidence).toBe(1.0);
      }
    });
  });

  describe('Consolidation Idempotency & Threshold Boundaries', () => {
    it('should reject consolidation when 0 or 1 micro-memories exist', () => {
      const srcFile = path.join(tempDir, 'lonely.ts');
      fs.writeFileSync(srcFile, 'export const lonely = true;');
      ctx.syncFileGraph(tempDir);

      // 0 memories
      const res0 = ctx.consolidateNeighborhood('lonely.ts');
      expect(res0.consolidatedId).toBe('');
      expect(res0.mergedCount).toBe(0);

      // 1 memory (threshold is >= 2)
      ctx.addMemory('lesson', 'Single Lesson', 'Detail', ['tag'], 'manual', undefined, 'lonely.ts');
      const res1 = ctx.consolidateNeighborhood('lonely.ts');
      expect(res1.consolidatedId).toBe('');
      expect(res1.mergedCount).toBe(0);
    });

    it('should not re-consolidate memories that are already consolidated', () => {
      const srcFile = path.join(tempDir, 'multi.ts');
      fs.writeFileSync(srcFile, 'export const multi = true;');
      ctx.syncFileGraph(tempDir);

      ctx.addMemory('warning', 'W1', 'Detail 1', ['tag1'], 'manual', undefined, 'multi.ts');
      ctx.addMemory('lesson', 'L1', 'Detail 2', ['tag2'], 'manual', undefined, 'multi.ts');

      // First consolidation
      const resFirst = ctx.consolidateNeighborhood('multi.ts');
      expect(resFirst.mergedCount).toBe(2);

      // Second consolidation without new micro-memories should do nothing
      const resSecond = ctx.consolidateNeighborhood('multi.ts');
      expect(resSecond.mergedCount).toBe(0);
      expect(resSecond.consolidatedId).toBe('');
    });
  });
});

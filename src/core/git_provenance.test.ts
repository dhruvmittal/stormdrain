import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { ContextManager } from './context';
import { normalizeRepoPath, makeFileVertexId } from '../utils/fileGraphScanner';
import { initSchema } from '../db/schema';

describe('Git Branch Provenance & Path Normalization', () => {
  let testDir: string;
  let ctx: ContextManager;
  const contextName = 'test_git_provenance';

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain-provenance-test-'));
    process.env.STORMDRAIN_TEST_DIR = testDir;
    ctx = new ContextManager(contextName);
  });

  afterEach(async () => {
    await ctx.close();
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  describe('Path Normalization & Vertex Parity', () => {
    it('normalizes various path styles to uniform posix relative path', () => {
      expect(normalizeRepoPath('./src/core/context.ts')).toBe('src/core/context.ts');
      expect(normalizeRepoPath('.///src/core/context.ts')).toBe('src/core/context.ts');
      expect(normalizeRepoPath('/src/core/context.ts')).toBe('src/core/context.ts');
      expect(normalizeRepoPath('src\\core\\context.ts')).toBe('src/core/context.ts');
      expect(normalizeRepoPath('.\\src\\core\\context.ts')).toBe('src/core/context.ts');
    });

    it('generates identical vertex IDs for relative and leading-dot paths', () => {
      const id1 = makeFileVertexId('src/utils/fileGraphScanner.ts');
      const id2 = makeFileVertexId('./src/utils/fileGraphScanner.ts');
      const id3 = makeFileVertexId('/src/utils/fileGraphScanner.ts');
      const id4 = makeFileVertexId('.\\src\\utils\\fileGraphScanner.ts');

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
      expect(id3).toBe(id4);
    });
  });

  describe('Database Schema Migration Idempotency', () => {
    it('migrates legacy table without git_branch and is_canonical columns', () => {
      const dbPath = path.join(testDir, 'legacy.db');
      const rawDb = new Database(dbPath);

      // Create a legacy memories table lacking git_branch and is_canonical
      rawDb.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          confidence REAL NOT NULL,
          source TEXT NOT NULL,
          created TEXT NOT NULL,
          updated TEXT NOT NULL,
          accessed TEXT NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 0,
          superseded_by TEXT
        );
      `);

      // Run initSchema to verify safe ALTER TABLE
      expect(() => initSchema(rawDb)).not.toThrow();

      // Running initSchema a second time should be idempotent
      expect(() => initSchema(rawDb)).not.toThrow();

      // Verify columns exist
      const cols = rawDb.prepare("PRAGMA table_info(memories)").all() as any[];
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('git_branch');
      expect(colNames).toContain('is_canonical');

      rawDb.close();
    });
  });

  describe('Branch Provenance in Memories & Recall', () => {
    it('defaults is_canonical = true on main/master branches', () => {
      const memId = ctx.addMemory(
        'fact',
        'Main Baseline Fact',
        'Baseline rule',
        ['baseline'],
        'manual',
        undefined,
        undefined,
        'affects',
        undefined,
        'main'
      );

      const mem = ctx.getMemory(memId);
      expect(mem).toBeDefined();
      expect(mem?.metadata.git_branch).toBe('main');
      expect(mem?.metadata.is_canonical).toBe(true);
    });

    it('persists git_branch and is_canonical = false on feature branches', () => {
      const memId = ctx.addMemory(
        'decision',
        'Feature Experiment',
        'Trying approach X',
        ['experiment'],
        'manual',
        undefined,
        undefined,
        'affects',
        undefined,
        'feature-xyz',
        false
      );

      const mem = ctx.getMemory(memId);
      expect(mem).toBeDefined();
      expect(mem?.metadata.git_branch).toBe('feature-xyz');
      expect(mem?.metadata.is_canonical).toBe(false);
    });

    it('filters feature branch memories from other branches during recallMultiHop', () => {
      const targetFile = 'src/service.ts';
      const vertexId = makeFileVertexId(targetFile);

      // Add target file vertex
      ctx.addMemory('codemap', targetFile, 'service codemap', ['file-vertex'], 'indexer', vertexId);

      // Add memory on feature-a (non-canonical)
      const memA = ctx.addMemory(
        'decision',
        'Feature A Decision',
        'Specific to feature A',
        ['test'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'feature-a',
        false
      );

      // Add canonical memory on main
      const memMain = ctx.addMemory(
        'fact',
        'Main Architecture Rule',
        'Always validate input',
        ['arch'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'main',
        true
      );

      // Recalling on feature-a should see both memA and memMain
      const recallA = ctx.recallMultiHop(targetFile, { branch: 'feature-a' });
      const idsA = recallA.all.map(m => m.id);
      expect(idsA).toContain(memA);
      expect(idsA).toContain(memMain);

      // Recalling on main should NOT see memA, but should see memMain
      const recallMain = ctx.recallMultiHop(targetFile, { branch: 'main' });
      const idsMain = recallMain.all.map(m => m.id);
      expect(idsMain).not.toContain(memA);
      expect(idsMain).toContain(memMain);

      // Recalling without specifying branch defaults to canonical/baseline view
      const recallNoBranch = ctx.recallMultiHop(targetFile);
      const idsNoBranch = recallNoBranch.all.map(m => m.id);
      expect(idsNoBranch).not.toContain(memA);
      expect(idsNoBranch).toContain(memMain);
    });

    it('always preserves invariant memories across branches', () => {
      const targetFile = 'src/core/security.ts';
      const vertexId = makeFileVertexId(targetFile);
      ctx.addMemory('codemap', targetFile, 'security vertex', ['file-vertex'], 'indexer', vertexId);

      // Add invariant on a feature branch
      const invMem = ctx.addMemory(
        'invariant',
        'Critical Security Rule',
        'Never log credentials',
        ['security'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'feature-sec',
        false
      );

      // Recall on main should still include invariant memories
      const recallMain = ctx.recallMultiHop(targetFile, { branch: 'main' });
      const idsMain = recallMain.all.map(m => m.id);
      expect(idsMain).toContain(invMem);
    });
  });

  describe('Promotion Workflow', () => {
    it('promotes single memory via updateMemory', () => {
      const memId = ctx.addMemory(
        'learning',
        'Discovered Edge Case',
        'Edge case details',
        ['gotcha'],
        'manual',
        undefined,
        undefined,
        'affects',
        undefined,
        'feature-branch',
        false
      );

      expect(ctx.getMemory(memId)?.metadata.is_canonical).toBe(false);

      // Promote memory
      ctx.updateMemory(memId, undefined, undefined, undefined, undefined, { is_canonical: true });

      const updated = ctx.getMemory(memId);
      expect(updated?.metadata.is_canonical).toBe(true);
    });

    it('promotes entire branch via promoteBranch', () => {
      const mem1 = ctx.addMemory('fact', 'Branch Fact 1', 'Content 1', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-p', false);
      const mem2 = ctx.addMemory('decision', 'Branch Decision 2', 'Content 2', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-p', false);
      const memOther = ctx.addMemory('fact', 'Other Branch Fact', 'Content 3', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-other', false);

      const promotedCount = ctx.promoteBranch('feature-p');
      expect(promotedCount).toBe(2);

      expect(ctx.getMemory(mem1)?.metadata.is_canonical).toBe(true);
      expect(ctx.getMemory(mem2)?.metadata.is_canonical).toBe(true);
      expect(ctx.getMemory(memOther)?.metadata.is_canonical).toBe(false);
    });
  });

  describe('Search & Empty Query Crash Guard', () => {
    it('handles empty query string with branch and unpromotedOnly filters safely without FTS syntax error', () => {
      ctx.addMemory('fact', 'Unpromoted Fact', 'Specific fact', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-f', false);
      ctx.addMemory('fact', 'Canonical Fact', 'Universal fact', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-f', true);

      // Empty query with unpromotedOnly filter should not throw FTS syntax error
      const resultsUnpromoted = ctx.searchMemories('', true, { branch: 'feature-f', unpromotedOnly: true });
      expect(resultsUnpromoted.length).toBe(1);
      expect(resultsUnpromoted[0].title).toBe('Unpromoted Fact');

      // Whitespace query with branch filter
      const resultsBranch = ctx.searchMemories('   ', true, { branch: 'feature-f' });
      expect(resultsBranch.length).toBe(2);

      // Normal text query with branch filter
      const resultsText = ctx.searchMemories('Specific', true, { branch: 'feature-f' });
      expect(resultsText.length).toBe(1);
      expect(resultsText[0].title).toBe('Unpromoted Fact');
    });
  });
});

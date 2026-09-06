import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { ContextManager } from './context';
import { normalizeRepoPath, makeFileVertexId } from '../utils/fileGraphScanner';
import { getCurrentGitBranch, isBranchMergedInto } from '../utils/gitUtils';
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
      expect(normalizeRepoPath('src/utils/../core/context.ts')).toBe('src/core/context.ts');
      expect(normalizeRepoPath('./a/b/../../c/d.ts')).toBe('c/d.ts');
      expect(normalizeRepoPath('../../c/d.ts')).toBe('c/d.ts');
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

    it('handles workspaceRoot prefix boundaries accurately without false prefix stripping', () => {
      const root = '/home/repo';
      // Inside workspace root
      expect(normalizeRepoPath('/home/repo/src/core.ts', root)).toBe('src/core.ts');
      // Sibling folder with same prefix should NOT have its name mutilated
      expect(normalizeRepoPath('/home/repo-other/src/core.ts', root)).toBe('home/repo-other/src/core.ts');
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

    it('preserves canonical invariant memories across branches and isolates unpromoted ones', () => {
      const targetFile = 'src/core/security.ts';
      const vertexId = makeFileVertexId(targetFile);
      ctx.addMemory('codemap', targetFile, 'security vertex', ['file-vertex'], 'indexer', vertexId);

      // Add canonical invariant on main
      const canonInv = ctx.addMemory(
        'invariant',
        'Critical Security Rule',
        'Never log credentials',
        ['security'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'main',
        true
      );

      // Recall on feature-sec includes canonical invariant
      const recallBranch = ctx.recallMultiHop(targetFile, { branch: 'feature-sec' });
      const idsBranch = recallBranch.all.map(m => m.id);
      expect(idsBranch).toContain(canonInv);

      // Recall on main also includes canonical invariant
      const recallMain = ctx.recallMultiHop(targetFile, { branch: 'main' });
      const idsMain = recallMain.all.map(m => m.id);
      expect(idsMain).toContain(canonInv);
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

    it('promotes and isolates slashed branch names like feature/login', () => {
      const slashedBranch = 'feature/login';
      const mem = ctx.addMemory('fact', 'Login Flow', 'Content', [], 'manual', undefined, undefined, 'affects', undefined, slashedBranch, false);

      expect(ctx.getMemory(mem)?.metadata.is_canonical).toBe(false);
      const promoted = ctx.promoteBranch(slashedBranch);
      expect(promoted).toBe(1);
      expect(ctx.getMemory(mem)?.metadata.is_canonical).toBe(true);
    });

    it('allows unsetting git_branch to null without retaining old branch in SQLite', () => {
      const mem = ctx.addMemory('fact', 'Branch Fact', 'Content', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-to-clear', false);
      expect(ctx.getMemory(mem)?.metadata.git_branch).toBe('feature-to-clear');

      // Update to null
      ctx.updateMemory(mem, undefined, undefined, undefined, undefined, { git_branch: null });
      const updated = ctx.getMemory(mem);
      expect(updated?.metadata.git_branch).toBeNull();

      // Verify SQLite row directly
      const row = ctx.getDb().prepare('SELECT git_branch FROM memories WHERE id = ?').get(mem) as any;
      expect(row.git_branch).toBeNull();
    });

    it('populates git_branch and is_canonical in listMemories and getNodeDetails', () => {
      const mem = ctx.addMemory('fact', 'Metadata Check', 'Content', [], 'manual', undefined, undefined, 'affects', undefined, 'feature-meta', false);

      const all = ctx.listMemories();
      const found = all.find(m => m.metadata.id === mem);
      expect(found).toBeDefined();
      expect(found?.metadata.git_branch).toBe('feature-meta');
      expect(found?.metadata.is_canonical).toBe(false);

      const details = ctx.getNodeDetails(mem);
      expect(details).toBeDefined();
      expect(details?.git_branch).toBe('feature-meta');
      expect(details?.is_canonical).toBe(false);
    });

    it('propagates branch through recallGraph to filter branch-specific memories', () => {
      const targetFile = 'src/api/auth.ts';
      const vertexId = makeFileVertexId(targetFile);
      ctx.addMemory('codemap', targetFile, 'auth codemap', ['file-vertex'], 'indexer', vertexId);

      const memBranch = ctx.addMemory('fact', 'Branch Auth Rule', 'Auth details', [], 'manual', undefined, targetFile, 'affects', undefined, 'feature-auth', false);
      const memMain = ctx.addMemory('fact', 'Main Auth Rule', 'Main details', [], 'manual', undefined, targetFile, 'affects', undefined, 'main', true);

      // recallGraph on feature-auth
      const resultsBranch = ctx.recallGraph(targetFile, 2, 'feature-auth');
      const idsBranch = resultsBranch.map(m => m.id);
      expect(idsBranch).toContain(memBranch);
      expect(idsBranch).toContain(memMain);

      // recallGraph on main
      const resultsMain = ctx.recallGraph(targetFile, 2, 'main');
      const idsMain = resultsMain.map(m => m.id);
      expect(idsMain).not.toContain(memBranch);
      expect(idsMain).toContain(memMain);
    });
  });

  describe('Git Worktree and Submodule Support', () => {
    it('resolves branch from .git file pointing to gitdir', () => {
      const mockWorktreeDir = path.join(testDir, 'worktree-repo');
      const mockGitDir = path.join(testDir, 'main-repo', '.git', 'worktrees', 'worktree-repo');
      fs.mkdirSync(mockWorktreeDir, { recursive: true });
      fs.mkdirSync(mockGitDir, { recursive: true });

      // Create .git file in worktree
      fs.writeFileSync(path.join(mockWorktreeDir, '.git'), `gitdir: ${mockGitDir}\n`);
      // Create HEAD in gitdir
      fs.writeFileSync(path.join(mockGitDir, 'HEAD'), 'ref: refs/heads/feature/worktree-branch\n');

      const detectedBranch = getCurrentGitBranch(mockWorktreeDir);
      expect(detectedBranch).toBe('feature/worktree-branch');
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

  describe('Dual-Plane Visibility Gate', () => {
    it('strictly isolates unpromoted invariants to their feature branch', () => {
      const targetFile = 'src/security/crypto.ts';
      const vertexId = makeFileVertexId(targetFile);
      ctx.addMemory('codemap', targetFile, 'crypto codemap', ['file-vertex'], 'indexer', vertexId);

      // Unpromoted invariant on feature-proto
      const unpromotedInvariant = ctx.addMemory(
        'invariant',
        'Proto Invariant: Skip Signature Check',
        'Do not verify signatures in proto',
        [],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'feature-proto',
        false
      );

      // Canonical invariant on main
      const canonicalInvariant = ctx.addMemory(
        'invariant',
        'Production Invariant: Strict Signature Check',
        'Always verify signatures with public key',
        [],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'main',
        true
      );

      // On feature-proto: both are visible
      const protoRecall = ctx.recallMultiHop(targetFile, { branch: 'feature-proto' });
      const protoIds = protoRecall.all.map(m => m.id);
      expect(protoIds).toContain(unpromotedInvariant);
      expect(protoIds).toContain(canonicalInvariant);

      // On main: unpromoted invariant MUST BE HIDDEN
      const mainRecall = ctx.recallMultiHop(targetFile, { branch: 'main' });
      const mainIds = mainRecall.all.map(m => m.id);
      expect(mainIds).not.toContain(unpromotedInvariant);
      expect(mainIds).toContain(canonicalInvariant);
    });

    it('allows observation plane memories tagged with #environment to cross branch boundaries', () => {
      const targetFile = 'src/core/testRunner.ts';
      const vertexId = makeFileVertexId(targetFile);
      ctx.addMemory('codemap', targetFile, 'runner codemap', ['file-vertex'], 'indexer', vertexId);

      // Empirical lesson tagged #environment on feature branch
      const envLesson = ctx.addMemory(
        'lesson',
        'Vitest Concurrency Quirk',
        'Worker threads exceed 8 on Linux 6.x causes deadlocks',
        ['#environment', 'testing'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'feature-perf',
        false
      );

      // Standard feature-specific lesson without environment tag
      const domainLesson = ctx.addMemory(
        'lesson',
        'Feature Internal Detail',
        'Internal helper method details',
        ['internal'],
        'manual',
        undefined,
        targetFile,
        'affects',
        undefined,
        'feature-perf',
        false
      );

      // On main: envLesson is visible, domainLesson is hidden
      const mainRecall = ctx.recallMultiHop(targetFile, { branch: 'main' });
      const mainIds = mainRecall.all.map(m => m.id);
      expect(mainIds).toContain(envLesson);
      expect(mainIds).not.toContain(domainLesson);
    });
  });

  describe('Automated PR / Squash Merge Promotion', () => {
    it('automatically detects merged branches and promotes them in autoPromoteMergedBranches', () => {
      const repoDir = path.join(testDir, 'auto-promote-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      const exec = (cmd: string) => require('child_process').execSync(cmd, { cwd: repoDir, stdio: 'pipe' });

      exec('git init -b main');
      exec('git config user.email "test@example.com"');
      exec('git config user.name "Test Runner"');
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Initial');
      exec('git add . && git commit -m "Initial commit"');

      // Add unpromoted memory for branch feature/auth-squash
      ctx.addMemory(
        'concept',
        'Auth Architecture',
        'Details of auth overhaul',
        ['auth'],
        'manual',
        undefined,
        undefined,
        'affects',
        undefined,
        'feature/auth-squash',
        false
      );

      // Simulate a GitHub squash-merge commit on main referencing the PR branch
      fs.writeFileSync(path.join(repoDir, 'auth.ts'), 'export const auth = true;');
      exec('git add . && git commit -m "feat: auth overhaul (#42)\n\nMerged from branch feature/auth-squash"');

      // Check autoPromoteMergedBranches
      const promoted = ctx.autoPromoteMergedBranches(repoDir);
      expect(promoted).toContain('feature/auth-squash');

      // Verify in SQLite that memory is now is_canonical = 1
      const row = ctx.getDb().prepare("SELECT is_canonical FROM memories WHERE git_branch = 'feature/auth-squash'").get() as any;
      expect(row.is_canonical).toBe(1);
    });
  });

  describe('CI Detached HEAD Resolution', () => {
    it('resolves active branch from GITHUB_HEAD_REF when HEAD is detached', () => {
      const repoDir = path.join(testDir, 'ci-detached-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      const exec = (cmd: string) => require('child_process').execSync(cmd, { cwd: repoDir, stdio: 'pipe' });

      exec('git init -b main');
      exec('git config user.email "ci@example.com"');
      exec('git config user.name "CI Runner"');
      fs.writeFileSync(path.join(repoDir, 'ci.txt'), 'CI file');
      exec('git add . && git commit -m "CI commit"');

      // Detach HEAD
      exec('git checkout --detach HEAD');

      const oldEnv = process.env.GITHUB_HEAD_REF;
      try {
        process.env.GITHUB_HEAD_REF = 'feature/pr-42-auth';
        const detected = getCurrentGitBranch(repoDir);
        expect(detected).toBe('feature/pr-42-auth');
      } finally {
        if (oldEnv === undefined) delete process.env.GITHUB_HEAD_REF;
        else process.env.GITHUB_HEAD_REF = oldEnv;
      }
    });
  });

  describe('Branch-Segmented Hash Decay Guard', () => {
    it('does not decay canonical memories when file is modified on a feature branch', () => {
      const repoDir = path.join(testDir, 'decay-guard-repo');
      fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      const exec = (cmd: string) => require('child_process').execSync(cmd, { cwd: repoDir, stdio: 'pipe' });

      exec('git init -b main');
      exec('git config user.email "decay@example.com"');
      exec('git config user.name "Decay Guard"');
      const testFile = path.join(repoDir, 'src', 'service.ts');
      fs.writeFileSync(testFile, 'export const version = 1;\n');
      exec('git add . && git commit -m "Initial service"');

      // Initial scan on main
      ctx.syncFileGraph(repoDir);

      // Add a canonical memory attached to service.ts
      const canonMemId = ctx.addMemory(
        'fact',
        'Canonical Service Rule',
        'Never mutate version',
        [],
        'manual',
        undefined,
        'src/service.ts',
        'affects',
        undefined,
        'main',
        true
      );
      const initialConf = (ctx.getMemory(canonMemId) as any).metadata.confidence;
      expect(initialConf).toBe(1.0);

      // Now switch git branch to feature/experiment
      exec('git checkout -b feature/experiment');

      // Mutate file on feature branch
      fs.writeFileSync(testFile, 'export const version = 2;\nexport const proto = true;\n');

      // Run syncFileGraph while on feature/experiment
      const scanResult = ctx.syncFileGraph(repoDir);

      // Canonical memory should NOT have decayed!
      const canonMemAfter = ctx.getMemory(canonMemId) as any;
      expect(canonMemAfter.metadata.confidence).toBe(1.0);
      expect(canonMemAfter.metadata.tags).not.toContain('stale');
    });
  });
});

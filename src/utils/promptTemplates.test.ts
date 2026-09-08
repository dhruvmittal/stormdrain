import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from '../core/context';
import { generateCuratePrompt, generateHarvestPrompt } from './promptTemplates';
import { execSync } from 'child_process';

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

describe('Prompt Templates Engine: /sd_harvest', () => {
  let tempDir: string;
  let ctx: ContextManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_harvest_test_'));
    process.env.STORMDRAIN_TEST_DIR = tempDir;
    ctx = new ContextManager('test_harvest_ctx');
  });

  afterEach(async () => {
    if (ctx) await ctx.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('generates structured harvest prompt with git branch, commits, and memory extraction rubric', async () => {
    // Initialize a mock git repo in an isolated workspace dir
    const workspaceDir = path.join(tempDir, 'mock_workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    execSync('git init -b feature/auth-flow', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.name "Tester"', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.email "tester@example.com"', { cwd: workspaceDir, stdio: 'pipe' });

    // Create a commit
    const testFile = path.join(workspaceDir, 'src', 'auth.ts');
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, 'export function login() {}');
    execSync('git add . && git commit -m "feat: implement login service"', { cwd: workspaceDir, stdio: 'pipe' });

    // Create an uncommitted change
    const anotherFile = path.join(workspaceDir, 'src', 'token.ts');
    fs.writeFileSync(anotherFile, 'export function verifyToken() {}');

    const result = await generateHarvestPrompt(ctx, { workspaceDir, limit: 5 });

    expect(result.title).toContain('Discovery Harvest: feature/auth-flow (test_harvest_ctx)');
    expect(result.promptText).toContain('# 🌾 StormDrain Discovery Harvest');
    expect(result.promptText).toContain('feature/auth-flow');
    expect(result.promptText).toContain('feat: implement login service');
    expect(result.promptText).toContain('src/auth.ts');
    expect(result.promptText).toContain('src/token.ts');
    // Ensure all 6 memory types are highlighted
    expect(result.promptText).toContain('`warning`');
    expect(result.promptText).toContain('`fact`');
    expect(result.promptText).toContain('`lesson`');
    expect(result.promptText).toContain('`pattern`');
    expect(result.promptText).toContain('`sequence`');
    expect(result.promptText).toContain('`guide`');
    // Ensure concepts/codemaps are explicitly excluded
    expect(result.promptText).toContain('High-level architectural `concept` nodes and AST `codemap` files are managed separately; do not create them');
    expect(result.promptText).toContain('sd_add({');
  });

  it('cross-references existing memories on touched files to prevent duplicate entries', async () => {
    // Initialize mock git repo in isolated workspace dir
    const workspaceDir = path.join(tempDir, 'mock_workspace_db');
    fs.mkdirSync(workspaceDir, { recursive: true });

    execSync('git init -b main', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.name "Tester"', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.email "tester@example.com"', { cwd: workspaceDir, stdio: 'pipe' });

    const testFile = path.join(workspaceDir, 'src', 'db.ts');
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, 'export const db = {};');
    execSync('git add . && git commit -m "db setup"', { cwd: workspaceDir, stdio: 'pipe' });

    // Add a memory in StormDrain targeting src/db.ts
    ctx.addMemory(
      'fact',
      'SQLite WAL Mode Invariant',
      'Must set PRAGMA journal_mode=WAL before read queries.',
      ['#invariant', '#sqlite'],
      'manual',
      undefined,
      'src/db.ts'
    );

    const result = await generateHarvestPrompt(ctx, { workspaceDir });

    expect(result.promptText).toContain('Existing Memories on Touched Files (Avoid Duplicating These)');
    expect(result.promptText).toContain('SQLite WAL Mode Invariant');
    expect(result.promptText).toContain('[FACT]');
    expect(result.promptText).toContain('src/db.ts');
  });

  it('gracefully handles non-git or empty workspaces without errors', async () => {
    // Non-git directory
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_empty_test_'));
    try {
      const result = await generateHarvestPrompt(ctx, { workspaceDir: emptyDir });
      expect(result.promptText).toContain('No recent commits found');
      expect(result.promptText).toContain('No recently modified files detected');
      expect(result.promptText).toContain('Discovery Extraction Rubric');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

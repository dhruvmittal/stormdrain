import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from '../core/context';
import { ConfigManager } from '../core/config';

describe('removeVerticesByPattern', () => {
  let tmpDir: string;
  let ctx: ContextManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-rm-test-'));
    process.env.STORMDRAIN_TEST_DIR = tmpDir;

    // Initialize config
    new ConfigManager();

    ctx = new ContextManager('test_rm');
  });

  afterEach(async () => {
    await ctx.close();
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function addFileVertex(relPath: string) {
    ctx.addMemory('codemap', `[File] ${relPath}`, `File Node: \`${relPath}\`\nHash: \`abc123\``, ['file-vertex'], 'auto-scan');
  }

  it('should match exact file path', () => {
    addFileVertex('src/main.ts');
    addFileVertex('src/utils.ts');
    addFileVertex('lib/helper.ts');

    const result = ctx.removeVerticesByPattern('src/main.ts');
    expect(result.matchedCount).toBe(1);
    expect(result.removedCount).toBe(1);
    expect(result.matchedFiles).toEqual(['src/main.ts']);
  });

  it('should match directory prefix', () => {
    addFileVertex('data/file1.csv');
    addFileVertex('data/nested/file2.csv');
    addFileVertex('src/main.ts');

    const result = ctx.removeVerticesByPattern('data');
    expect(result.matchedCount).toBe(2);
    expect(result.removedCount).toBe(2);
    expect(result.matchedFiles).toContain('data/file1.csv');
    expect(result.matchedFiles).toContain('data/nested/file2.csv');
  });

  it('should match directory with trailing slash', () => {
    addFileVertex('sim_output/result.dat');
    addFileVertex('src/main.ts');

    const result = ctx.removeVerticesByPattern('sim_output/');
    expect(result.matchedCount).toBe(1);
    expect(result.matchedFiles).toContain('sim_output/result.dat');
  });

  it('should match wildcard patterns with *', () => {
    addFileVertex('data/file1.csv');
    addFileVertex('data/file2.csv');
    addFileVertex('data/file3.json');

    const result = ctx.removeVerticesByPattern('data/*.csv');
    expect(result.matchedCount).toBe(2);
    expect(result.removedCount).toBe(2);
    expect(result.matchedFiles).not.toContain('data/file3.json');
  });

  it('should match ** recursive glob', () => {
    addFileVertex('src/old/a.ts');
    addFileVertex('src/old/nested/b.ts');
    addFileVertex('src/new/c.ts');

    const result = ctx.removeVerticesByPattern('src/old/**');
    expect(result.matchedCount).toBe(2);
    expect(result.matchedFiles).toContain('src/old/a.ts');
    expect(result.matchedFiles).toContain('src/old/nested/b.ts');
  });

  it('should support dry-run mode', () => {
    addFileVertex('data/file1.csv');
    addFileVertex('data/file2.csv');

    const result = ctx.removeVerticesByPattern('data', { dryRun: true });
    expect(result.matchedCount).toBe(2);
    expect(result.removedCount).toBe(0);

    // Verify nothing was actually deleted
    const check = ctx.removeVerticesByPattern('data', { dryRun: true });
    expect(check.matchedCount).toBe(2);
  });

  it('should return zero matches for non-existent pattern', () => {
    addFileVertex('src/main.ts');

    const result = ctx.removeVerticesByPattern('nonexistent/**');
    expect(result.matchedCount).toBe(0);
    expect(result.removedCount).toBe(0);
  });

  it('should match submodule vertices', () => {
    ctx.addMemory('codemap', '[Submodule] libs/mylib', 'Submodule summary', ['submodule', 'codemap'], 'auto-scan');
    addFileVertex('src/main.ts');

    const result = ctx.removeVerticesByPattern('libs/mylib');
    expect(result.matchedCount).toBe(1);
    expect(result.matchedFiles).toContain('libs/mylib');
  });
});

describe('deleteContext', () => {
  let tmpDir: string;
  let config: ConfigManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-delctx-test-'));
    process.env.STORMDRAIN_TEST_DIR = tmpDir;
    config = new ConfigManager();
  });

  afterEach(() => {
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should refuse to delete _global', () => {
    expect(() => config.deleteContext('_global')).toThrow('Cannot delete the _global context');
  });

  it('should throw for non-existent context', () => {
    expect(() => config.deleteContext('nonexistent')).toThrow('does not exist');
  });

  it('should delete a context and fall back active to _global', () => {
    config.addContext('myproject', ['/tmp/myproject']);
    config.setActiveContext('myproject');
    expect(config.getActiveContext()).toBe('myproject');

    config.deleteContext('myproject', false);
    expect(config.getActiveContext()).toBe('_global');
    expect(config.getContext('myproject')).toBeUndefined();
  });

  it('should purge context directory from disk', () => {
    config.addContext('purgeme', ['/tmp/purgeme']);
    
    // Create a ContextManager to populate disk
    const ctx = new ContextManager('purgeme');
    ctx.addMemory('fact', 'test', 'test content');
    
    const ctxPath = path.join(tmpDir, 'contexts', 'purgeme');
    expect(fs.existsSync(ctxPath)).toBe(true);
    
    ctx.close();
    config.deleteContext('purgeme', true);
    
    expect(fs.existsSync(ctxPath)).toBe(false);
    expect(config.getContext('purgeme')).toBeUndefined();
  });

  it('should not purge disk when purgeDisk is false', () => {
    config.addContext('keepdata', ['/tmp/keepdata']);
    const ctx = new ContextManager('keepdata');
    ctx.addMemory('fact', 'test', 'test content');
    
    const ctxPath = path.join(tmpDir, 'contexts', 'keepdata');
    expect(fs.existsSync(ctxPath)).toBe(true);
    
    ctx.close();
    config.deleteContext('keepdata', false);
    
    // Directory should still exist
    expect(fs.existsSync(ctxPath)).toBe(true);
    // But config entry should be removed
    expect(config.getContext('keepdata')).toBeUndefined();
  });
});

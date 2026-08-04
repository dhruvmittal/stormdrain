import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from './config';

describe('ConfigManager', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_test_${Date.now()}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should create default config if not exists', () => {
    const config = new ConfigManager();
    const active = config.getActiveContext();
    expect(active).toBe('_global');
    
    const contexts = config.getContexts();
    expect(contexts['_global']).toBeDefined();
    
    // Verify file was written
    expect(fs.existsSync(path.join(testDir, 'config.json'))).toBe(true);
  });

  it('should add a context and save it', () => {
    const config = new ConfigManager();
    config.addContext('my-project', ['/path/to/project']);
    
    const ctx = config.getContext('my-project');
    expect(ctx?.name).toBe('my-project');
    expect(ctx?.paths).toContain('/path/to/project');
    
    // Create new instance to test loading from disk
    const config2 = new ConfigManager();
    expect(config2.getContext('my-project')?.paths).toContain('/path/to/project');
  });

  it('should correctly resolve context by cwd', () => {
    const config = new ConfigManager();
    config.addContext('project-a', ['/home/user/code/a']);
    config.addContext('project-b', ['/home/user/code/b']);
    config.addContext('project-a-sub', ['/home/user/code/a/sub']);
    
    expect(config.resolveContextByCwd('/home/user/code/a/src/file.ts')).toBe('project-a');
    expect(config.resolveContextByCwd('/home/user/code/b/README.md')).toBe('project-b');
    // Longest match wins
    expect(config.resolveContextByCwd('/home/user/code/a/sub/index.ts')).toBe('project-a-sub');
    
    expect(config.resolveContextByCwd('/tmp')).toBeNull();
  });

  it('should resolve context using 4-tier hierarchy', () => {
    const config = new ConfigManager();
    config.addContext('proj-explicit', []);
    config.addContext('proj-env', []);
    config.addContext('proj-cwd', ['/workspace/path']);
    config.setActiveContext('_global');

    // Tier 1: Explicit argument
    expect(config.resolveContext('proj-explicit', '/workspace/path')).toBe('proj-explicit');

    // Tier 2: Environment variable override
    process.env.STORMDRAIN_CONTEXT = 'proj-env';
    expect(config.resolveContext(undefined, '/workspace/path')).toBe('proj-env');
    delete process.env.STORMDRAIN_CONTEXT;

    // Tier 3: CWD path match
    expect(config.resolveContext(undefined, '/workspace/path')).toBe('proj-cwd');

    // Tier 4: Fallback to global active context
    expect(config.resolveContext(undefined, '/unregistered/path')).toBe('_global');
  });

  it('should bind path to context correctly', () => {
    const config = new ConfigManager();
    config.addContext('proj-bound', []);
    
    config.bindPathToContext('proj-bound', '/my/bound/path');
    expect(config.resolveContextByCwd('/my/bound/path/subfolder')).toBe('proj-bound');
  });
});

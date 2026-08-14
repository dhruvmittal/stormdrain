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

  it('should initialize and return default settings', () => {
    const config = new ConfigManager();
    const settings = config.getSettings();
    expect(settings.readTool.enabled).toBe(true);
    expect(settings.readTool.mode).toBe('auto');
    expect(settings.readTool.tokenBudget).toBe(500);
    expect(settings.graph.forwardWeight).toBe(0.80);
    expect(settings.graph.reverseWeight).toBe(0.25);
    expect(settings.decay.decayRate).toBe(0.85);
    expect(settings.git.debounceMs).toBe(1500);
    expect(settings.graph.attenuateInterModule).toBe(true);
    expect(settings.graph.freezeOutOfScopeNodes).toBe(true);
    expect(settings.graph.interModuleTensionRatio).toBe(0.25);
    expect(settings.graph.memoryChargeStrength).toBe(-140);
  });

  it('should update settings partially and persist to disk', () => {
    const config = new ConfigManager();
    const updated = config.updateSettings({
      readTool: {
        enabled: true,
        mode: 'tokensave',
        cachePolicy: 'always',
        tokenBudget: 800,
        maxHops: 3,
        includeSymbols: false
      },
      graph: {
        forwardWeight: 0.90,
        reverseWeight: 0.35,
        cumulativeMassThreshold: 0.90,
        pushThreshold: 0.0005,
        consolidationThreshold: 5
      }
    });

    expect(updated.readTool.mode).toBe('tokensave');
    expect(updated.readTool.tokenBudget).toBe(800);
    expect(updated.graph.forwardWeight).toBe(0.90);
    // Unmodified sub-fields should retain defaults
    expect(updated.decay.decayRate).toBe(0.85);
    expect(updated.git.debounceMs).toBe(1500);

    // Verify reloaded instance reads from disk
    const config2 = new ConfigManager();
    const loaded = config2.getSettings();
    expect(loaded.readTool.mode).toBe('tokensave');
    expect(loaded.readTool.tokenBudget).toBe(800);
    expect(loaded.graph.forwardWeight).toBe(0.90);
  });

  it('should reset settings to default values', () => {
    const config = new ConfigManager();
    config.updateSettings({
      readTool: {
        enabled: false,
        mode: 'disabled',
        cachePolicy: 'always',
        tokenBudget: 1200,
        maxHops: 1,
        includeSymbols: false
      }
    });
    expect(config.getSettings().readTool.tokenBudget).toBe(1200);

    const reset = config.resetSettings();
    expect(reset.readTool.enabled).toBe(true);
    expect(reset.readTool.mode).toBe('auto');
    expect(reset.readTool.tokenBudget).toBe(500);
  });

  it('should honor environment variable overrides for settings', () => {
    process.env.STORMDRAIN_TOKEN_BUDGET = '950';
    process.env.STORMDRAIN_READ_MODE = 'standalone';
    process.env.STORMDRAIN_FORWARD_WEIGHT = '0.95';
    process.env.STORMDRAIN_REVERSE_WEIGHT = '0.40';
    process.env.STORMDRAIN_DECAY_RATE = '0.70';

    const config = new ConfigManager();
    const settings = config.getSettings();

    expect(settings.readTool.tokenBudget).toBe(950);
    expect(settings.readTool.mode).toBe('standalone');
    expect(settings.graph.forwardWeight).toBe(0.95);
    expect(settings.graph.reverseWeight).toBe(0.40);
    expect(settings.decay.decayRate).toBe(0.70);

    delete process.env.STORMDRAIN_TOKEN_BUDGET;
    delete process.env.STORMDRAIN_READ_MODE;
    delete process.env.STORMDRAIN_FORWARD_WEIGHT;
    delete process.env.STORMDRAIN_REVERSE_WEIGHT;
    delete process.env.STORMDRAIN_DECAY_RATE;
  });

  it('should reject binding home or root directory to project context', () => {
    const config = new ConfigManager();
    config.addContext('project-safe', []);

    expect(config.bindPathToContext('project-safe', os.homedir())).toBe(false);
    expect(config.bindPathToContext('project-safe', '/')).toBe(false);
    expect(config.getContext('project-safe')?.paths).toEqual([]);

    // _global can bind if explicitly done
    expect(config.bindPathToContext('_global', os.homedir())).toBe(true);
  });

  it('should unbind path from context', () => {
    const config = new ConfigManager();
    const fakePath = path.join(testDir, 'workspace');
    config.addContext('proj-unbind', [fakePath]);

    expect(config.getContext('proj-unbind')?.paths).toContain(fakePath);
    expect(config.unbindPathFromContext('proj-unbind', fakePath)).toBe(true);
    expect(config.getContext('proj-unbind')?.paths).not.toContain(fakePath);
    expect(config.unbindPathFromContext('proj-unbind', fakePath)).toBe(false);
  });
});



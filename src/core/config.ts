import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBasePath, getContextPath, ensureDirectories } from '../utils/paths';
import { GlobalConfig, ContextConfig, StormDrainSettings } from '../types';


export const DEFAULT_SETTINGS: StormDrainSettings = {
  readTool: {
    enabled: true,
    mode: 'auto',
    cachePolicy: 'first_read_only',
    tokenBudget: 500,
    maxHops: 2,
    includeSymbols: true,
    highlightAsPrimary: true
  },
  graph: {
    forwardWeight: 0.80,
    reverseWeight: 0.25,
    cumulativeMassThreshold: 0.85,
    pushThreshold: 0.0001,
    consolidationThreshold: 3
  },
  decay: {
    decayRate: 0.85,
    minFloor: 0.30
  },
  git: {
    enabled: true,
    debounceMs: 1500
  },
  colors: {
    nodes: {
      concept: '#38bdf8',  // Sky Blue
      codemap: '#0284c7',  // Deep Steel Blue (distinct from #38bdf8)
      fact: '#10b981',     // Emerald Green
      lesson: '#f59e0b',   // Amber
      pattern: '#8b5cf6',  // Purple
      warning: '#ef4444',  // Red
      guide: '#ec4899',    // Pink
      sequence: '#6366f1'  // Indigo
    },
    edges: {
      imports: '#38bdf8',
      affects: '#a855f7',
      applies_to: '#a855f7',
      supports: '#10b981',
      contradicts: '#ef4444',
      supersedes: '#f59e0b',
      depends_on: '#6366f1',
      references: '#64748b',
      related_to: '#64748b',
      defaultEdge: '#334155'
    }
  }
};

export class ConfigManager {
  private configPath: string;
  private config: GlobalConfig;

  constructor() {
    this.configPath = path.join(getBasePath(), 'config.json');
    ensureDirectories();
    this.config = this.loadConfig();
  }

  public loadConfig(): GlobalConfig {
    if (!fs.existsSync(this.configPath)) {
      const defaultCfg: GlobalConfig = {
        contexts: {
          _global: {
            name: '_global',
            paths: [],
            parent: null
          }
        },
        activeContext: '_global',
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
      };
      fs.writeFileSync(this.configPath, JSON.stringify(defaultCfg, null, 2));
      this.config = defaultCfg;
      return defaultCfg;
    }
    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    if (!this.config.settings) {
      this.config.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return this.config;
  }

  public saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  public getSettings(): StormDrainSettings {
    this.loadConfig();
    const disk = this.config.settings || DEFAULT_SETTINGS;
    
    // Deep clone default merged with disk settings
    const merged: StormDrainSettings = {
      readTool: { ...DEFAULT_SETTINGS.readTool, ...(disk.readTool || {}) },
      graph: { ...DEFAULT_SETTINGS.graph, ...(disk.graph || {}) },
      decay: { ...DEFAULT_SETTINGS.decay, ...(disk.decay || {}) },
      git: { ...DEFAULT_SETTINGS.git, ...(disk.git || {}) },
      colors: {
        nodes: { ...DEFAULT_SETTINGS.colors!.nodes, ...(disk.colors?.nodes || {}) },
        edges: { ...DEFAULT_SETTINGS.colors!.edges, ...(disk.colors?.edges || {}) }
      }
    };

    // Environment variable overrides
    if (process.env.STORMDRAIN_TOKEN_BUDGET) {
      const parsed = parseInt(process.env.STORMDRAIN_TOKEN_BUDGET, 10);
      if (!isNaN(parsed) && parsed > 0) merged.readTool.tokenBudget = parsed;
    }
    if (process.env.STORMDRAIN_READ_MODE) {
      const mode = process.env.STORMDRAIN_READ_MODE as any;
      if (['auto', 'tokensave', 'standalone', 'disabled'].includes(mode)) {
        merged.readTool.mode = mode;
      }
    }
    if (process.env.STORMDRAIN_READ_PRIMARY !== undefined) {
      merged.readTool.highlightAsPrimary = process.env.STORMDRAIN_READ_PRIMARY !== 'false' && process.env.STORMDRAIN_READ_PRIMARY !== '0';
    }
    if (process.env.STORMDRAIN_FORWARD_WEIGHT) {
      const parsed = parseFloat(process.env.STORMDRAIN_FORWARD_WEIGHT);
      if (!isNaN(parsed)) merged.graph.forwardWeight = parsed;
    }
    if (process.env.STORMDRAIN_REVERSE_WEIGHT) {
      const parsed = parseFloat(process.env.STORMDRAIN_REVERSE_WEIGHT);
      if (!isNaN(parsed)) merged.graph.reverseWeight = parsed;
    }
    if (process.env.STORMDRAIN_DECAY_RATE) {
      const parsed = parseFloat(process.env.STORMDRAIN_DECAY_RATE);
      if (!isNaN(parsed)) merged.decay.decayRate = parsed;
    }

    return merged;
  }

  public updateSettings(partial: Partial<StormDrainSettings>): StormDrainSettings {
    this.loadConfig();
    const current = this.getSettings();

    const updated: StormDrainSettings = {
      readTool: { ...current.readTool, ...(partial.readTool || {}) },
      graph: { ...current.graph, ...(partial.graph || {}) },
      decay: { ...current.decay, ...(partial.decay || {}) },
      git: { ...current.git, ...(partial.git || {}) },
      colors: {
        nodes: { ...current.colors!.nodes, ...(partial.colors?.nodes || {}) },
        edges: { ...current.colors!.edges, ...(partial.colors?.edges || {}) }
      }
    };

    this.config.settings = updated;
    this.saveConfig();
    return this.getSettings();
  }

  public resetSettings(): StormDrainSettings {
    this.loadConfig();
    this.config.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.saveConfig();
    return this.getSettings();
  }

  public getContexts(): Record<string, ContextConfig> {
    this.loadConfig();
    return this.config.contexts;
  }

  public getContext(name: string): ContextConfig | undefined {
    this.loadConfig();
    const resolvedName = name === 'global' ? '_global' : name;
    return this.config.contexts[resolvedName];
  }

  public getActiveContext(): string {
    this.loadConfig();
    return this.config.activeContext;
  }

  public setActiveContext(name: string) {
    const resolvedName = name === 'global' ? '_global' : name;
    if (!this.config.contexts[resolvedName]) {
      throw new Error(`Context ${name} does not exist.`);
    }
    this.config.activeContext = resolvedName;
    this.saveConfig();
  }

  public addContext(name: string, paths: string[] = [], parent: string | null = null) {
    if (name === 'global' || name === '_global') {
      throw new Error(`Context name "${name}" is a reserved system alias for the global context.`);
    }
    if (this.config.contexts[name]) {
      throw new Error(`Context ${name} already exists.`);
    }
    const resolvedParent = parent === 'global' ? '_global' : parent;
    if (resolvedParent && !this.config.contexts[resolvedParent]) {
      throw new Error(`Parent context ${parent} does not exist.`);
    }
    this.config.contexts[name] = { name, paths, parent: resolvedParent };
    ensureDirectories(name);
    this.saveConfig();
  }

  public static isSystemOrHomeRoot(targetPath: string): boolean {
    if (!targetPath) return false;
    const norm = path.resolve(targetPath);
    const home = path.resolve(os.homedir());
    const root = path.parse(norm).root;
    return norm === home || norm === root || norm === '/root' || norm === '/home';
  }

  public bindPathToContext(contextName: string, workspacePath: string): boolean {
    this.loadConfig();
    const resolvedName = contextName === 'global' ? '_global' : contextName;
    if (!this.config.contexts[resolvedName]) {
      throw new Error(`Context ${contextName} does not exist.`);
    }

    if (ConfigManager.isSystemOrHomeRoot(workspacePath) && resolvedName !== '_global') {
      return false;
    }

    const normPath = path.resolve(workspacePath);
    const existingPaths = this.config.contexts[resolvedName].paths || [];

    if (!existingPaths.includes(normPath)) {
      this.config.contexts[resolvedName].paths = [...existingPaths, normPath];
      this.saveConfig();
      return true;
    }
    return false;
  }

  public unbindPathFromContext(contextName: string, workspacePath: string): boolean {
    this.loadConfig();
    const resolvedName = contextName === 'global' ? '_global' : contextName;
    if (!this.config.contexts[resolvedName]) {
      throw new Error(`Context ${contextName} does not exist.`);
    }

    const normPath = path.resolve(workspacePath);
    const existingPaths = this.config.contexts[resolvedName].paths || [];
    const filtered = existingPaths.filter(p => path.resolve(p) !== normPath);

    if (filtered.length !== existingPaths.length) {
      this.config.contexts[resolvedName].paths = filtered;
      this.saveConfig();
      return true;
    }
    return false;
  }

  public deleteContext(name: string, purgeDisk: boolean = true): boolean {
    this.loadConfig();

    if (name === '_global' || name === 'global') {
      throw new Error('Cannot delete the _global context — it is the system fallback.');
    }

    if (!this.config.contexts[name]) {
      throw new Error(`Context "${name}" does not exist.`);
    }

    // If deleting the active context, fall back to _global
    if (this.config.activeContext === name) {
      this.config.activeContext = '_global';
    }

    delete this.config.contexts[name];
    this.saveConfig();

    // Purge context directory from disk
    if (purgeDisk) {
      const ctxDir = getContextPath(name);
      if (fs.existsSync(ctxDir)) {
        fs.rmSync(ctxDir, { recursive: true, force: true });
      }
    }

    return true;
  }

  public resolveContextByCwd(cwd: string): string | null {
    this.loadConfig();
    if (ConfigManager.isSystemOrHomeRoot(cwd)) {
      return null;
    }

    const normCwd = path.resolve(cwd);
    let match: string | null = null;
    let matchLen = 0;

    for (const ctx of Object.values(this.config.contexts)) {
      for (const p of ctx.paths || []) {
        if (ConfigManager.isSystemOrHomeRoot(p) && ctx.name !== '_global') {
          continue;
        }
        const normP = path.resolve(p);
        if (normCwd === normP || normCwd.startsWith(normP + path.sep)) {
          if (normP.length > matchLen) {
            match = ctx.name;
            matchLen = normP.length;
          }
        }
      }
    }
    return match;
  }


  public resolveContext(explicitContext?: string, cwd: string = process.cwd()): string {
    this.loadConfig();

    // Tier 1: Explicitly specified context argument (with 'global' -> '_global' normalization)
    if (explicitContext) {
      const resolvedExplicit = explicitContext === 'global' ? '_global' : explicitContext;
      if (this.config.contexts[resolvedExplicit]) {
        return resolvedExplicit;
      }
    }

    // Tier 2: Environment variable override
    const envContext = process.env.STORMDRAIN_CONTEXT;
    if (envContext) {
      const resolvedEnv = envContext === 'global' ? '_global' : envContext;
      if (this.config.contexts[resolvedEnv]) {
        return resolvedEnv;
      }
    }

    // Tier 3: Path matching based on working directory
    const cwdMatch = this.resolveContextByCwd(cwd);
    if (cwdMatch) {
      return cwdMatch;
    }

    // Tier 4: Global active context fallback
    return this.getActiveContext();
  }
}


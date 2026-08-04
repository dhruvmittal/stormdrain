import * as fs from 'fs';
import * as path from 'path';
import { getBasePath, ensureDirectories } from '../utils/paths';
import { GlobalConfig, ContextConfig } from '../types';

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
          '_global': { name: '_global', paths: [], parent: null }
        },
        activeContext: '_global'
      };
      fs.writeFileSync(this.configPath, JSON.stringify(defaultCfg, null, 2));
      this.config = defaultCfg;
      return defaultCfg;
    }
    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    return this.config;
  }

  public saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  public getContexts(): Record<string, ContextConfig> {
    this.loadConfig();
    return this.config.contexts;
  }

  public getContext(name: string): ContextConfig | undefined {
    this.loadConfig();
    return this.config.contexts[name];
  }

  public getActiveContext(): string {
    this.loadConfig();
    return this.config.activeContext;
  }

  public setActiveContext(name: string) {
    if (!this.config.contexts[name]) {
      throw new Error(`Context ${name} does not exist.`);
    }
    this.config.activeContext = name;
    this.saveConfig();
  }

  public addContext(name: string, paths: string[] = [], parent: string | null = null) {
    if (this.config.contexts[name]) {
      throw new Error(`Context ${name} already exists.`);
    }
    if (parent && !this.config.contexts[parent]) {
      throw new Error(`Parent context ${parent} does not exist.`);
    }
    this.config.contexts[name] = { name, paths, parent };
    ensureDirectories(name);
    this.saveConfig();
  }

  public bindPathToContext(contextName: string, workspacePath: string): boolean {
    this.loadConfig();
    if (!this.config.contexts[contextName]) {
      throw new Error(`Context ${contextName} does not exist.`);
    }

    const normPath = path.resolve(workspacePath);
    const existingPaths = this.config.contexts[contextName].paths || [];

    if (!existingPaths.includes(normPath)) {
      this.config.contexts[contextName].paths = [...existingPaths, normPath];
      this.saveConfig();
      return true;
    }
    return false;
  }

  public resolveContextByCwd(cwd: string): string | null {
    this.loadConfig();
    const normCwd = path.resolve(cwd);
    let match: string | null = null;
    let matchLen = 0;

    for (const ctx of Object.values(this.config.contexts)) {
      for (const p of ctx.paths || []) {
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

    // Tier 1: Explicitly specified context argument
    if (explicitContext && this.config.contexts[explicitContext]) {
      return explicitContext;
    }

    // Tier 2: Environment variable override
    const envContext = process.env.STORMDRAIN_CONTEXT;
    if (envContext && this.config.contexts[envContext]) {
      return envContext;
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

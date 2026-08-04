import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export const getBasePath = (): string => {
  if (process.env.STORMDRAIN_TEST_DIR) {
    return process.env.STORMDRAIN_TEST_DIR;
  }
  return path.join(os.homedir(), '.stormdrain');
};

export const getContextsPath = (): string => {
  return path.join(getBasePath(), 'contexts');
};

export const getContextPath = (contextName: string): string => {
  return path.join(getContextsPath(), contextName);
};

export const getContextMemoriesPath = (contextName: string): string => {
  return path.join(getContextPath(contextName), 'memories');
};

export const getContextDbPath = (contextName: string): string => {
  return path.join(getContextPath(contextName), 'index.db');
};

export const ensureDirectories = (contextName?: string) => {
  const base = getBasePath();
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

  const contexts = getContextsPath();
  if (!fs.existsSync(contexts)) fs.mkdirSync(contexts, { recursive: true });

  if (contextName) {
    const ctx = getContextPath(contextName);
    if (!fs.existsSync(ctx)) fs.mkdirSync(ctx, { recursive: true });
    
    const mems = getContextMemoriesPath(contextName);
    if (!fs.existsSync(mems)) fs.mkdirSync(mems, { recursive: true });
  }
};

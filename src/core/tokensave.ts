import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export class CodeIntelligence {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  private async isTokenSaveAvailable(): Promise<boolean> {
    try {
      await execAsync('tokensave --version');
      return true;
    } catch {
      return false;
    }
  }

  public async getContextForTask(task: string): Promise<string> {
    if (await this.isTokenSaveAvailable()) {
      try {
        // We simulate calling tokensave MCP or CLI. 
        // TokenSave doesn't have a direct CLI command for `tokensave_context` without MCP, 
        // so we could either start an MCP client to it or just return a placeholder.
        // For now, if tokensave is installed, we assume we can query it or we suggest using the tokensave MCP server directly.
        return `[TokenSave] Deferring to TokenSave for task: ${task}`;
      } catch (err) {
        console.error('TokenSave error:', err);
      }
    }
    
    // Minimal fallback
    return this.getMinimalContext();
  }

  private async getMinimalContext(): Promise<string> {
    try {
      // Very minimal fallback: list files in src directory if it exists
      const { stdout } = await execAsync('find . -maxdepth 3 -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -n 20', { cwd: this.cwd });
      return `### Minimal Code Structure\n\n${stdout}`;
    } catch {
      return 'No code context available.';
    }
  }
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { getContextPath } from '../utils/paths';

const execFileAsync = promisify(execFile);

export class GitManager {
  private contextName: string;
  private dir: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private commitMessageQueue: string[] = [];
  private initPromise: Promise<void>;
  private commitPromise: Promise<void> | null = null;

  constructor(contextName: string, debounceMs: number = 1500) {
    this.contextName = contextName;
    this.dir = getContextPath(contextName);
    this.debounceMs = debounceMs;
    this.initPromise = this.initRepo();
  }

  private async initRepo(): Promise<void> {
    const gitDir = path.join(this.dir, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        const env = { PATH: process.env.PATH || '/usr/bin:/bin:/run/current-system/sw/bin', ...process.env };
        await execFileAsync('git', ['init'], { cwd: this.dir, env });
        await execFileAsync('git', ['config', 'user.name', 'StormDrain'], { cwd: this.dir, env });
        await execFileAsync('git', ['config', 'user.email', 'stormdrain@local'], { cwd: this.dir, env });
      } catch (err) {
        console.error('Failed to initialize git repository:', err);
      }
    }
  }

  public scheduleCommit(commitMsg: string) {
    this.commitMessageQueue.push(commitMsg);

    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.commit().catch(err => console.error('Git auto-commit error:', err));
      }, this.debounceMs);
      
      if (this.debounceTimer.unref) {
        this.debounceTimer.unref();
      }
    }
  }

  public async commit(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.commitPromise) {
      await this.commitPromise;
      if (this.commitMessageQueue.length === 0) return;
    }

    this.commitPromise = this.runCommit();
    try {
      await this.commitPromise;
    } finally {
      this.commitPromise = null;
    }
  }

  private async runCommit(): Promise<void> {
    await this.initPromise;

    if (this.commitMessageQueue.length === 0) return;

    const messagesToCommit = [...this.commitMessageQueue];

    let combinedMessage = '';
    if (messagesToCommit.length > 20) {
      combinedMessage = `[stormdrain] Batch update: ${messagesToCommit.length} operations\n\n` +
        messagesToCommit.slice(0, 15).join('\n') +
        `\n... and ${messagesToCommit.length - 15} more operations`;
    } else {
      combinedMessage = messagesToCommit.join('\n');
    }

    if (combinedMessage.length > 4000) {
      combinedMessage = combinedMessage.substring(0, 3990) + '...';
    }

    try {
      const env = { PATH: process.env.PATH || '/usr/bin:/bin:/run/current-system/sw/bin', ...process.env };
      await execFileAsync('git', ['add', '.'], { cwd: this.dir, env });
      await execFileAsync('git', ['commit', '-m', combinedMessage], { cwd: this.dir, env });
      this.commitMessageQueue.splice(0, messagesToCommit.length);
    } catch (err: any) {
      const output = (err.stdout || '') + (err.stderr || '');
      if (output.includes('nothing to commit') || output.includes('clean')) {
        this.commitMessageQueue.splice(0, messagesToCommit.length);
      } else {
        console.error('Git commit failed:', err);
      }
    }
  }
}


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
  private commitMessageQueue: string[] = [];
  private initPromise: Promise<void>;

  constructor(contextName: string) {
    this.contextName = contextName;
    this.dir = getContextPath(contextName);
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
        this.commit().catch(err => console.error('Git auto-commit error:', err));
        this.debounceTimer = null;
      }, 300000);
      
      if (this.debounceTimer.unref) {
        this.debounceTimer.unref();
      }
    }
  }

  public async commit(): Promise<void> {
    await this.initPromise;

    if (this.commitMessageQueue.length === 0) return;

    const combinedMessage = this.commitMessageQueue.join('\n');
    this.commitMessageQueue = [];

    try {
      const env = { PATH: process.env.PATH || '/usr/bin:/bin:/run/current-system/sw/bin', ...process.env };
      await execFileAsync('git', ['add', '.'], { cwd: this.dir, env });
      await execFileAsync('git', ['commit', '-m', combinedMessage], { cwd: this.dir, env });
    } catch (err: any) {
      // Ignored - usually means no changes to commit
      const output = (err.stdout || '') + (err.stderr || '');
      if (!output.includes('nothing to commit') && !output.includes('clean')) {
        console.error('Git commit failed:', err);
      }
    }
  }
}


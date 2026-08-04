import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitManager } from './git';
import { getContextPath, ensureDirectories } from '../utils/paths';

const execFileAsync = promisify(execFile);

describe('GitManager', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_git_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should initialize git repository asynchronously', async () => {
    const ctxName = 'git-context';
    ensureDirectories(ctxName);
    const git = new GitManager(ctxName);
    const ctxPath = getContextPath(ctxName);

    // Creating a dummy file to commit
    fs.writeFileSync(path.join(ctxPath, 'dummy.txt'), 'hello');
    
    git.scheduleCommit('add dummy file');
    await git.commit();

    const gitDir = path.join(ctxPath, '.git');
    expect(fs.existsSync(gitDir)).toBe(true);

    const { stdout } = await execFileAsync('git', ['log', '-n', '1'], { cwd: ctxPath, env: process.env });
    expect(stdout).toContain('add dummy file');
  });

  it('should aggregate scheduled commit messages', async () => {
    const ctxName = 'git-context-queue';
    ensureDirectories(ctxName);
    const git = new GitManager(ctxName);
    const ctxPath = getContextPath(ctxName);

    fs.writeFileSync(path.join(ctxPath, 'file1.txt'), 'content 1');
    git.scheduleCommit('Commit line 1');
    git.scheduleCommit('Commit line 2');

    await git.commit();

    const { stdout } = await execFileAsync('git', ['log', '-n', '1'], { cwd: ctxPath, env: process.env });
    expect(stdout).toContain('Commit line 1');
    expect(stdout).toContain('Commit line 2');
  });

  it('should handle commit when there are no changes without throwing', async () => {
    const ctxName = 'git-context-empty';
    ensureDirectories(ctxName);
    const git = new GitManager(ctxName);
    git.scheduleCommit('No files changed');
    await expect(git.commit()).resolves.not.toThrow();
  });
});

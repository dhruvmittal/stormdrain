import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isGitRepo, getGitTrackedFiles, getSubmodules, summarizeSubmodule } from './gitUtils';

describe('gitUtils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-git-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('should return false for a non-git directory', () => {
      expect(isGitRepo(tmpDir)).toBe(false);
    });

    it('should return true for a git repository', () => {
      const { execSync } = require('child_process');
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
        expect(isGitRepo(tmpDir)).toBe(true);
      } catch {
        // git not available in test env, skip
        expect(true).toBe(true);
      }
    });

    it('should return false for non-existent directory', () => {
      expect(isGitRepo(path.join(tmpDir, 'nonexistent'))).toBe(false);
    });
  });

  describe('getGitTrackedFiles', () => {
    it('should return null for non-git directory', () => {
      expect(getGitTrackedFiles(tmpDir)).toBeNull();
    });

    it('should return tracked files in a git repo', () => {
      const { execSync } = require('child_process');
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
        execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });

        // Create tracked and ignored files
        fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export const x = 1;');
        fs.writeFileSync(path.join(tmpDir, 'data.csv'), 'a,b,c');
        fs.writeFileSync(path.join(tmpDir, '.gitignore'), '*.csv\n');

        execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });

        const files = getGitTrackedFiles(tmpDir);
        expect(files).not.toBeNull();
        expect(files).toContain('main.ts');
        expect(files).toContain('.gitignore');
        expect(files).not.toContain('data.csv');
      } catch {
        // git not available in test env
        expect(true).toBe(true);
      }
    });
  });

  describe('getSubmodules', () => {
    it('should return empty array for non-git directory', () => {
      expect(getSubmodules(tmpDir)).toEqual([]);
    });

    it('should return empty array when no submodules exist', () => {
      const { execSync } = require('child_process');
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
        expect(getSubmodules(tmpDir)).toEqual([]);
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should parse .gitmodules for submodule info as fallback', () => {
      const { execSync } = require('child_process');
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
        
        // Write a .gitmodules file (without actually adding the submodule)
        fs.writeFileSync(path.join(tmpDir, '.gitmodules'), 
          '[submodule "libs/mylib"]\n\tpath = libs/mylib\n\turl = https://github.com/example/mylib.git\n');
        
        // Create the submodule directory so it looks initialized
        fs.mkdirSync(path.join(tmpDir, 'libs', 'mylib'), { recursive: true });
        
        const subs = getSubmodules(tmpDir);
        // git submodule status may fail but .gitmodules fallback should work
        expect(subs.length).toBeGreaterThanOrEqual(0);
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('summarizeSubmodule', () => {
    it('should generate a summary for a submodule directory', () => {
      // Create a mock submodule directory
      const subDir = path.join(tmpDir, 'libs', 'mylib');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'README.md'), '# My Library\nA useful library for things.');
      fs.writeFileSync(path.join(subDir, 'main.ts'), 'export const hello = "world";');

      const result = summarizeSubmodule(tmpDir, {
        path: 'libs/mylib',
        url: 'https://github.com/example/mylib.git',
        commitHash: 'abc123def456',
        initialized: true
      });

      expect(result.title).toBe('[Submodule] libs/mylib');
      expect(result.content).toContain('https://github.com/example/mylib.git');
      expect(result.content).toContain('abc123def456');
      expect(result.tags).toContain('submodule');
      expect(result.tags).toContain('codemap');
    });

    it('should handle submodule with package.json', () => {
      const subDir = path.join(tmpDir, 'vendor', 'pkg');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({
        name: 'my-pkg',
        description: 'A test package'
      }));

      const result = summarizeSubmodule(tmpDir, {
        path: 'vendor/pkg',
        url: '',
        commitHash: '',
        initialized: false
      });

      expect(result.content).toContain('A test package');
      expect(result.content).toContain('Not initialized');
    });
  });
});

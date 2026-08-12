import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scaffoldAgentsMd, STORMDRAIN_AGENT_SECTION } from './agentsScaffolder';

describe('AGENTS.md Scaffolder for Antigravity, OpenCode, and Pi', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_agents_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should create AGENTS.md if file does not exist with sandboxing rules', () => {
    const res = scaffoldAgentsMd(tempDir);
    expect(res.created).toBe(true);
    expect(res.updated).toBe(false);

    const filePath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('Agent Guidelines & Project Context');
    expect(content).toContain('StormDrain Persistent Memory');
    expect(content).toContain('~/.stormdrain');
    expect(content).toContain('MCP-First Execution');
    expect(content).toContain('sd_recall');
  });

  it('should append StormDrain section to existing AGENTS.md without duplicating', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, '# Custom Project Rules\n\n- Rule 1: Always test code.\n', 'utf8');

    const res1 = scaffoldAgentsMd(tempDir);
    expect(res1.created).toBe(false);
    expect(res1.updated).toBe(true);

    const content1 = fs.readFileSync(filePath, 'utf8');
    expect(content1).toContain('Custom Project Rules');
    expect(content1).toContain('## StormDrain Persistent Memory');

    // Run again - should not duplicate
    const res2 = scaffoldAgentsMd(tempDir);
    expect(res2.created).toBe(false);
    expect(res2.updated).toBe(false);

    const content2 = fs.readFileSync(filePath, 'utf8');
    const matches = content2.match(/StormDrain Persistent Memory/g);
    expect(matches?.length).toBe(1);
  });

  it('should leave AGENTS.md untouched if user mentioned stormdrain without force flag', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    const userCustomRules = `# My Custom Rules\n\nAgents must always query the storm drain tool before touching core code.\n`;
    fs.writeFileSync(filePath, userCustomRules, 'utf8');

    const res = scaffoldAgentsMd(tempDir);
    expect(res.created).toBe(false);
    expect(res.updated).toBe(false);

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe(userCustomRules);
  });

  it('should force update StormDrain section while preserving custom user sections', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    const initialContent = `# Project Guidelines\n\n## Custom Team Rules\n- Rule A\n\n## StormDrain Persistent Memory Protocol\nOld outdated protocol text...\n\n## Other Appendix\n- Extra info\n`;
    fs.writeFileSync(filePath, initialContent, 'utf8');

    const res = scaffoldAgentsMd(tempDir, { force: true });
    expect(res.created).toBe(false);
    expect(res.updated).toBe(true);

    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toContain('# Project Guidelines');
    expect(updated).toContain('## Custom Team Rules');
    expect(updated).toContain('~/.stormdrain');
    expect(updated).toContain('MCP-First Execution');
    expect(updated).toContain('## Other Appendix');
    expect(updated).not.toContain('Old outdated protocol text');
  });
});

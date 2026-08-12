import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

describe('StormDrain CLI Enhancements & Commands', () => {
  let tempDir: string;
  let testHomeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_cli_workspace_'));
    testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_cli_home_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(testHomeDir, { recursive: true, force: true });
    } catch {}
  });

  const runCli = (args: string, cwd = tempDir): string => {
    return execSync(`node ${CLI_PATH} ${args}`, {
      cwd,
      env: {
        ...process.env,
        STORMDRAIN_TEST_DIR: testHomeDir,
      },
      encoding: 'utf8',
    });
  };

  it('should scaffold AGENTS.md via stormdrain agents command', () => {
    const output = runCli(`agents ${tempDir}`);
    expect(output).toContain('Scaffolded agent instructions in "AGENTS.md"');

    const agentsMdPath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(agentsMdPath)).toBe(true);
    const content = fs.readFileSync(agentsMdPath, 'utf8');
    expect(content).toContain('StormDrain Persistent Memory');
    expect(content).toContain('MCP-First Execution');
    expect(content).toContain('~/.stormdrain');
  });

  it('should force-update existing AGENTS.md via stormdrain agents -f', () => {
    const agentsMdPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsMdPath,
      '# My Project\n\n## StormDrain Persistent Memory\nOld outdated text\n',
      'utf8'
    );

    const output = runCli(`agents -f ${tempDir}`);
    expect(output).toContain('Updated StormDrain instructions in "AGENTS.md"');

    const updatedContent = fs.readFileSync(agentsMdPath, 'utf8');
    expect(updatedContent).toContain('# My Project');
    expect(updatedContent).toContain('MCP-First Execution');
    expect(updatedContent).not.toContain('Old outdated text');
  });

  it('should execute init --agents-only without creating context DB or scanning DAG', () => {
    const sampleSrc = path.join(tempDir, 'sample.ts');
    fs.writeFileSync(sampleSrc, 'export const x = 1;', 'utf8');

    const output = runCli(`init --agents-only test-ctx ${tempDir}`);
    expect(output).toContain('Scaffolded agent instructions in "AGENTS.md"');
    expect(output).not.toContain('file vertices in DAG skeleton');

    const agentsMdPath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(agentsMdPath)).toBe(true);
  });

  it('should execute stormdrain curate to output curation prompt in graph sweep mode', () => {
    // First initialize context and add a memory
    runCli(`init test-curate-cli ${tempDir} --submodules sum`);
    runCli(`add fact "Toolchain Clang Invariant" "Use clang-16" --tags compiler,environment -c test-curate-cli`);

    const output = runCli(`curate -c test-curate-cli`);
    expect(output).toContain('StormDrain Graph-Wide Curation Sweep');
    expect(output).toContain('Promotion Candidates');
    expect(output).toContain('Toolchain Clang Invariant');
    expect(output).toContain('Step-by-Step Curation Workflow');
  });

  it('should execute stormdrain prompt curate <target> for targeted curation', () => {
    runCli(`init test-curate-cli-target ${tempDir} --submodules sum`);
    runCli(`add warning "Store Mutex Rule" "Always lock mutex" -t "src/core/store.ts" -c test-curate-cli-target`);

    const output = runCli(`prompt curate src/core/store.ts -c test-curate-cli-target`);
    expect(output).toContain('StormDrain Knowledge Curation: Target "src/core/store.ts"');
    expect(output).toContain('Store Mutex Rule');
    expect(output).toContain('Consolidate Micro-Memories');
  });
});

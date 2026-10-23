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
    expect(content).toContain('Authorized Execution (MCP or CLI)');
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
    expect(updatedContent).toContain('Authorized Execution (MCP or CLI)');
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

  it('should add memory with --json flag and parse id programmatically', () => {
    runCli(`init test-json-ctx ${tempDir} --submodules sum`);
    const addOut = runCli(`add fact "CLI JSON Fact" "Detailed fact body" --json -c test-json-ctx`);
    const parsed = JSON.parse(addOut);
    expect(parsed.id).toMatch(/^mem_[a-f0-9]+/);
    expect(parsed.title).toBe('CLI JSON Fact');
    expect(parsed.status).toBe('added');
  });

  it('should add memory with --file and stdin (-)', () => {
    runCli(`init test-file-ctx ${tempDir} --submodules sum`);

    // 1. Using --file
    const noteFile = path.join(tempDir, 'notes.md');
    fs.writeFileSync(noteFile, 'Detailed markdown from external file', 'utf8');
    const out1 = runCli(`add guide "External Guide" --file ${noteFile} --json -c test-file-ctx`);
    const parsed1 = JSON.parse(out1);
    expect(parsed1.id).toBeDefined();

    // 2. Using stdin (-)
    const stdinCmd = `echo "Content piped from stdin stream" | node ${CLI_PATH} add fact "Stdin Fact" - --json -c test-file-ctx`;
    const out2 = execSync(stdinCmd, {
      cwd: tempDir,
      env: { ...process.env, STORMDRAIN_TEST_DIR: testHomeDir },
      encoding: 'utf8',
    });
    const parsed2 = JSON.parse(out2);
    expect(parsed2.id).toBeDefined();
    expect(parsed2.title).toBe('Stdin Fact');
  });

  it('should search memories with --json output', () => {
    runCli(`init test-search-ctx ${tempDir} --submodules sum`);
    runCli(`add fact "Unique Search Zebra" "Zebra content description" -c test-search-ctx`);

    const searchOut = runCli(`search "Zebra" --json -c test-search-ctx`);
    const parsed = JSON.parse(searchOut);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].title).toBe('Unique Search Zebra');
  });

  it('should recall multi-hop memories for target file and support --json', () => {
    runCli(`init test-recall-ctx ${tempDir} --submodules sum`);
    runCli(`add warning "Config Invariant" "Do not mutate config in place" -t "src/core/config.ts" -c test-recall-ctx`);

    // Human readable
    const textOut = runCli(`recall -t "src/core/config.ts" -c test-recall-ctx`);
    expect(textOut).toContain('Direct File Invariants');
    expect(textOut).toContain('Config Invariant');
    expect(textOut).toContain('Do not mutate config in place');

    // JSON
    const jsonOut = runCli(`recall -t "src/core/config.ts" --json -c test-recall-ctx`);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.direct).toBeDefined();
    expect(parsed.direct.length).toBeGreaterThan(0);
    expect(parsed.direct[0].title).toBe('Config Invariant');
  });

  it('should consolidate memories via top-level stormdrain consolidate command', () => {
    runCli(`init test-consolidate-ctx ${tempDir} --submodules sum`);
    runCli(`add fact "Micro 1" "Fact 1 content" -t "src/service.ts" -c test-consolidate-ctx`);
    runCli(`add fact "Micro 2" "Fact 2 content" -t "src/service.ts" -c test-consolidate-ctx`);

    const candOut = runCli(`candidates -t 2 --json -c test-consolidate-ctx`);
    const candidates = JSON.parse(candOut);
    expect(candidates.length).toBeGreaterThan(0);

    const consOut = runCli(`consolidate "src/service.ts" --json -c test-consolidate-ctx`);
    const consResult = JSON.parse(consOut);
    expect(consResult.consolidatedId).toBeDefined();
    expect(consResult.mergedCount).toBe(2);
  });
});

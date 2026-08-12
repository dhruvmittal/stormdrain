import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

describe('StormDrain CLI Tab Completion', () => {
  let tempDir: string;
  let testHomeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_comp_workspace_'));
    testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd_comp_home_'));
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

  it('should generate bash completion script', () => {
    const output = runCli('completion bash');
    expect(output).toContain('# bash completion for stormdrain');
    expect(output).toContain('__stormdrain_complete()');
    expect(output).toContain('complete -F __stormdrain_complete stormdrain');
  });

  it('should generate zsh completion script', () => {
    const output = runCli('completion zsh');
    expect(output).toContain('_stormdrain()');
    expect(output).toContain('compdef _stormdrain stormdrain');
  });

  it('should generate fish completion script', () => {
    const output = runCli('completion fish');
    expect(output).toContain('complete -c stormdrain');
    expect(output).toContain('__stormdrain_prepare_completions');
  });

  it('should generate powershell completion script', () => {
    const output = runCli('completion powershell');
    expect(output).toContain('Register-ArgumentCompleter');
    expect(output).toContain('stormdrain');
  });

  it('should suggest top-level subcommands on complete -- ""', () => {
    const output = runCli('complete -- ""');
    expect(output).toContain('init');
    expect(output).toContain('add');
    expect(output).toContain('context');
    expect(output).toContain('graph');
    expect(output).toContain('relate');
    expect(output).toContain('search');
    expect(output).toContain('get');
    expect(output).toContain('delete');
    expect(output).toContain('curate');
    expect(output).toContain('completion');
  });

  it('should suggest memory types for add positional argument', () => {
    const output = runCli('complete -- add ""');
    expect(output).toContain('concept');
    expect(output).toContain('fact');
    expect(output).toContain('lesson');
    expect(output).toContain('pattern');
    expect(output).toContain('warning');
    expect(output).toContain('guide');
    expect(output).toContain('sequence');
  });

  it('should suggest graph actions for graph subcommand', () => {
    const output = runCli('complete -- graph ""');
    expect(output).toContain('scan');
    expect(output).toContain('consolidate');
  });

  it('should suggest context actions for context subcommand', () => {
    const output = runCli('complete -- context ""');
    expect(output).toContain('list');
    expect(output).toContain('create');
    expect(output).toContain('use');
    expect(output).toContain('bind');
    expect(output).toContain('unbind');
    expect(output).toContain('delete');
  });

  it('should suggest relation types for relate subcommand and --relation-type option', () => {
    const relateOutput = runCli('complete -- relate mem_src mem_tgt ""');
    expect(relateOutput).toContain('affects');
    expect(relateOutput).toContain('supports');
    expect(relateOutput).toContain('contradicts');
    expect(relateOutput).toContain('supersedes');
    expect(relateOutput).toContain('depends_on');

    const flagOutput = runCli('complete -- add fact "t" "c" --relation-type ""');
    expect(flagOutput).toContain('affects');
    expect(flagOutput).toContain('distilled_from');
  });

  it('should suggest submodule policies for --submodules option', () => {
    const output = runCli('complete -- init --submodules ""');
    expect(output).toContain('dive');
    expect(output).toContain('sum');
    expect(output).toContain('ask');
  });

  it('should dynamically suggest registered context names for --context option and context use argument', () => {
    // Initialize two distinct contexts in the isolated test home directory
    runCli(`init project-alpha ${tempDir} --submodules sum`);
    runCli(`init project-beta ${tempDir} --submodules sum`);

    const flagOutput = runCli('complete -- add fact "t" "c" --context ""');
    expect(flagOutput).toContain('project-alpha');
    expect(flagOutput).toContain('project-beta');
    expect(flagOutput).toContain('_global');

    const useOutput = runCli('complete -- context use ""');
    expect(useOutput).toContain('project-alpha');
    expect(useOutput).toContain('project-beta');
  });

  it('should dynamically suggest memory IDs for get and delete subcommands', () => {
    // Initialize context and add sample memories
    runCli(`init test-ids ${tempDir} --submodules sum`);
    runCli(`add fact "Clang Compiler Version" "Clang 16 required" -c test-ids`);
    runCli(`add warning "Lock Contention" "Do not acquire lock recursively" -c test-ids`);

    const getOutput = runCli('complete -- get ""');
    expect(getOutput).toContain('Clang Compiler Version');
    expect(getOutput).toContain('Lock Contention');

    const delOutput = runCli('complete -- delete ""');
    expect(delOutput).toContain('Clang Compiler Version');
    expect(delOutput).toContain('Lock Contention');
  });
});

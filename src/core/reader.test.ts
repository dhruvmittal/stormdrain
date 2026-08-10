import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileReader } from './reader';
import { ConfigManager } from './config';
import { ContextManager } from './context';
import { MultiHopMemoryResult } from '../types';

describe('FileReader Engine (sd_read)', () => {
  let tempDir: string;
  let config: ConfigManager;
  let reader: FileReader;
  let testContext = 'reader_test_context';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain_reader_test_'));
    process.env.STORMDRAIN_TEST_DIR = tempDir;
    config = new ConfigManager();
    config.addContext(testContext, [tempDir]);
    config.setActiveContext(testContext);
    reader = new FileReader(config);
  });

  afterEach(async () => {
    delete process.env.STORMDRAIN_TEST_DIR;
    delete process.env.STORMDRAIN_TOKEN_BUDGET;
    delete process.env.STORMDRAIN_READ_MODE;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should read a full file and format with line numbers', async () => {
    const filePath = path.join(tempDir, 'sample.ts');
    const content = ['import express from "express";', '', 'export function hello() {', '  return "world";', '}', ''].join('\n');
    fs.writeFileSync(filePath, content, 'utf8');

    const result = await reader.readFile({
      filePath,
      cwd: tempDir
    });

    expect(result.totalLines).toBe(6);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(6);
    expect(result.content).toContain('1: import express from "express";');
    expect(result.content).toContain('3: export function hello() {');
    expect(result.content).toContain('4:   return "world";');
    expect(result.symbols).toContain('export function hello');
  });

  it('should slice file by startLine and endLine with boundary clamping', async () => {
    const filePath = path.join(tempDir, 'lines.ts');
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

    const result = await reader.readFile({
      filePath,
      startLine: 5,
      endLine: 10,
      cwd: tempDir
    });

    expect(result.startLine).toBe(5);
    expect(result.endLine).toBe(10);
    expect(result.content).toContain(' 5: Line 5');
    expect(result.content).toContain('10: Line 10');
    expect(result.content).not.toContain('Line 4');
    expect(result.content).not.toContain('Line 11');

    // Test clamped bounds
    const clamped = await reader.readFile({
      filePath,
      startLine: 50,
      endLine: 100,
      cwd: tempDir
    });
    expect(clamped.startLine).toBe(20);
    expect(clamped.endLine).toBe(20);
  });

  it('should throw error when reading non-existent file or a directory', async () => {
    await expect(reader.readFile({ filePath: path.join(tempDir, 'missing.ts') }))
      .rejects.toThrow('File not found');

    await expect(reader.readFile({ filePath: tempDir }))
      .rejects.toThrow('Path is a directory');
  });

  it('should extract AST symbol outlines across multiple programming languages', () => {
    // TypeScript / JS
    const tsCode = `
      export class UserService {}
      export interface UserConfig {}
      export type ID = string;
      export enum Status { ACTIVE }
      export const API_URL = "http://localhost";
      class InternalHelper {}
    `;
    const tsSymbols = reader.extractSymbolOutline('service.ts', tsCode);
    expect(tsSymbols).toContain('export class UserService');
    expect(tsSymbols).toContain('export interface UserConfig');
    expect(tsSymbols).toContain('export type ID');
    expect(tsSymbols).toContain('export enum Status');
    expect(tsSymbols).toContain('export const API_URL');
    expect(tsSymbols).toContain('class InternalHelper');

    // Python
    const pyCode = `
class AuthHandler:
    pass

def authenticate_user():
    pass
    `;
    const pySymbols = reader.extractSymbolOutline('auth.py', pyCode);
    expect(pySymbols).toContain('class AuthHandler');
    expect(pySymbols).toContain('def authenticate_user');

    // Rust
    const rsCode = `
pub struct MemoryPool;
pub enum PacketType {}
pub fn process_data() {}
    `;
    const rsSymbols = reader.extractSymbolOutline('pool.rs', rsCode);
    expect(rsSymbols).toContain('pub struct MemoryPool');
    expect(rsSymbols).toContain('pub enum PacketType');
    expect(rsSymbols).toContain('pub fn process_data');

    // Go
    const goCode = `
type Server struct {}
type Handler interface {}
func NewServer() *Server {}
    `;
    const goSymbols = reader.extractSymbolOutline('main.go', goCode);
    expect(goSymbols).toContain('type Server struct');
    expect(goSymbols).toContain('type Handler interface');
    expect(goSymbols).toContain('func NewServer');
  });

  it('should inject multi-hop topological invariants when present in graph', async () => {
    const filePath = path.join(tempDir, 'core.ts');
    fs.writeFileSync(filePath, 'export const DB_VERSION = 2;\n', 'utf8');

    const ctx = new ContextManager(testContext);
    try {
      ctx.syncFileGraph(tempDir);
      ctx.addMemory('warning', 'DB Migration Invariant', 'Always run migrations before modifying schema', ['database'], 'manual', undefined, 'core.ts');
      ctx.addMemory('fact', 'Version Constant', 'DB_VERSION is currently set to 2', ['version'], 'manual', undefined, 'core.ts');
    } finally {
      await ctx.close();
    }

    const result = await reader.readFile({
      filePath: 'core.ts',
      cwd: tempDir,
      context: testContext
    });

    expect(result.invariantsInjected).toBe(true);
    expect(result.invariantsCount).toBeGreaterThanOrEqual(1);
    expect(result.content).toContain('StormDrain Architectural Invariants & Caller Constraints: core.ts');
    expect(result.content).toContain('[WARNING] DB Migration Invariant');
  });

  it('should honor invariant token budget limits and format headers gracefully', () => {
    const mockMemories: MultiHopMemoryResult[] = [
      { id: 'mem_1', type: 'warning', title: 'Critical Warning 1', content: 'Do not mutate shared state directly', confidence: 0.95, depth: 0, tags: ['safety'] },
      { id: 'mem_2', type: 'lesson', title: 'Async Handling Lesson', content: 'Always await promises inside try-catch', confidence: 0.85, depth: 1, tags: ['async'] },
      { id: 'mem_3', type: 'fact', title: 'Cache Strategy', content: 'Uses LRU eviction', confidence: 0.75, depth: 2, tags: ['perf'] }
    ];

    // Very small token budget (~30 tokens -> ~120 chars)
    const truncatedHeader = reader.formatInvariantHeader('test.ts', mockMemories, 30);
    expect(truncatedHeader).toContain('Critical Warning 1');
    expect(truncatedHeader).toContain('omitted for token budget');

    // Empty memories
    expect(reader.formatInvariantHeader('empty.ts', [])).toBe('');
  });

  it('should respect cache policies (first_read_only, on_file_changed, always)', async () => {
    const filePath = path.join(tempDir, 'cache_test.ts');
    fs.writeFileSync(filePath, 'export const X = 1;\n', 'utf8');

    const ctx = new ContextManager(testContext);
    try {
      ctx.syncFileGraph(tempDir);
      ctx.addMemory('warning', 'Cache Policy Warning', 'Check cache behavior', [], 'manual', undefined, 'cache_test.ts');
    } finally {
      await ctx.close();
    }


    // 1. first_read_only (default)
    const read1 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read1.cached).toBe(false);
    expect(read1.content).toContain('Cache Policy Warning');

    const read2 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read2.cached).toBe(true);
    expect(read2.content).toContain('Topological invariants cached for this session');

    // 2. on_file_changed
    config.updateSettings({ readTool: { ...config.getSettings().readTool, cachePolicy: 'on_file_changed' } });
    reader.clearSessionCache();

    const read3 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read3.cached).toBe(false);

    // Read again without changes -> cached
    const read4 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read4.cached).toBe(true);

    // Mutate file -> should re-inject
    fs.writeFileSync(filePath, 'export const X = 2;\nexport const Y = 3;\n', 'utf8');
    const read5 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read5.cached).toBe(false);

    // 3. always
    config.updateSettings({ readTool: { ...config.getSettings().readTool, cachePolicy: 'always' } });
    const read6 = await reader.readFile({ filePath, cwd: tempDir, context: testContext });
    expect(read6.cached).toBe(false);
  });

  it('should suppress memory injection when readTool is disabled or mode is disabled', async () => {
    const filePath = path.join(tempDir, 'disabled.ts');
    fs.writeFileSync(filePath, 'export const Z = 99;\n', 'utf8');

    config.updateSettings({ readTool: { ...config.getSettings().readTool, mode: 'disabled' } });
    const result = await reader.readFile({ filePath, cwd: tempDir });
    expect(result.invariantsInjected).toBe(false);
    expect(result.content).not.toContain('StormDrain Architectural Invariants');
  });
});

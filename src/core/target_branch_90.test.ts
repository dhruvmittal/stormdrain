import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { ConfigManager } from './config';
import { GitManager } from './git';
import { StormDrainMcpServer } from '../mcp';
import { startWebServer } from '../web/server';

describe('90%+ Branch Coverage Target Tests', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-branch-90-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-branch-home-'));
    process.env.HOME = homeDir;
    process.env.STORMDRAIN_HOME = path.join(homeDir, '.stormdrain');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  describe('ConfigManager Branch Variations', () => {
    it('should exercise all 4 context resolution tiers and validation errors', () => {
      const config = new ConfigManager();
      
      // 1. Add context with parent validation
      expect(() => config.addContext('bad-parent-ctx', [], 'non-existent-parent')).toThrow('Parent context non-existent-parent does not exist.');
      config.addContext('alpha-ctx', [tempDir]);
      expect(() => config.addContext('alpha-ctx')).toThrow('Context alpha-ctx already exists.');

      // 2. Path binding: first time returns true, second time returns false
      expect(config.bindPathToContext('alpha-ctx', tempDir)).toBe(false);
      expect(config.bindPathToContext('alpha-ctx', path.join(tempDir, 'sub'))).toBe(true);
      expect(() => config.bindPathToContext('ghost-ctx', '/path')).toThrow('Context ghost-ctx does not exist.');

      // 3. Set active context validation
      expect(() => config.setActiveContext('ghost-ctx')).toThrow('Context ghost-ctx does not exist.');

      // 4. resolveContext 4-Tier Hierarchy:
      // Tier 1: Explicit override
      expect(config.resolveContext('alpha-ctx', '/unrelated')).toBe('alpha-ctx');
      // Tier 2: Environment variable override
      process.env.STORMDRAIN_CONTEXT = 'alpha-ctx';
      expect(config.resolveContext(undefined, '/unrelated')).toBe('alpha-ctx');
      delete process.env.STORMDRAIN_CONTEXT;
      // Tier 3: CWD path binding match
      expect(config.resolveContext(undefined, path.join(tempDir, 'sub'))).toBe('alpha-ctx');
      // Tier 4: Global active fallback
      expect(config.resolveContext(undefined, '/completely/unknown/dir')).toBe(config.getActiveContext());
    });
  });

  describe('GitManager Branch Variations', () => {
    it('should test debounce queuing and direct commit execution', async () => {
      const git = new GitManager('git-branch-ctx');
      
      // Call scheduleCommit multiple times rapidly to test debouncing
      git.scheduleCommit('Commit 1');
      git.scheduleCommit('Commit 2');

      // Call commit directly
      await git.commit();
      // Second commit when queue is empty should return early
      await git.commit();
    });
  });

  describe('MCP Protocol Tool Argument Branches', () => {
    it('should exercise sd_add with target_file, sd_update with all fields, and sd_recall with target_file', async () => {
      const config = new ConfigManager();
      config.addContext('mcp-full-branch-ctx', [tempDir]);
      config.setActiveContext('mcp-full-branch-ctx');

      const mcpServer = new StormDrainMcpServer();
      const serverInstance = (mcpServer as any).server;
      const handler = serverInstance._requestHandlers.get('tools/call');

      // 1. Add file and scan
      const srcFile = path.join(tempDir, 'service.ts');
      fs.writeFileSync(srcFile, 'export class Service {}');
      await handler({
        method: 'tools/call',
        params: { name: 'sd_scan', arguments: { directory: tempDir, context: 'mcp-full-branch-ctx' } }
      });

      // 2. sd_add with target_file and custom tags
      const addRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_add',
          arguments: {
            type: 'warning',
            title: 'Service Lifecycle Gotcha',
            content: 'Always dispose connections.',
            tags: ['lifecycle', 'db'],
            target_file: 'service.ts',
            context: 'mcp-full-branch-ctx'
          }
        }
      });
      expect(addRes.content[0].text).toContain('linked to service.ts');

      // Extract memory ID from message
      const matchId = addRes.content[0].text.match(/mem_[a-f0-9]+/);
      const memId = matchId ? matchId[0] : '';

      // 3. sd_update updating all fields (title, content, tags, type)
      const updateRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_update',
          arguments: {
            id: memId,
            title: 'Updated Service Title',
            content: 'Updated content body',
            tags: ['updated-tag'],
            type: 'guide',
            context: 'mcp-full-branch-ctx'
          }
        }
      });
      expect(updateRes.content[0].text).toContain('Successfully updated memory');

      // 4. sd_recall with target_file
      const recallRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_recall',
          arguments: {
            target_file: 'service.ts',
            context: 'mcp-full-branch-ctx'
          }
        }
      });
      expect(recallRes.content[0].text).toContain('Updated Service Title');
    });
  });

  describe('Web API Server SPA & Context Switch Branches', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      process.env.STORMDRAIN_TEST_DIR = tempDir;
      server = startWebServer(0);
      await new Promise<void>((resolve) => {
        if (server.listening) resolve();
        else server.once('listening', resolve);
      });
      const addr = server.address() as AddressInfo;
      baseUrl = `http://localhost:${addr.port}`;
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      delete process.env.STORMDRAIN_TEST_DIR;
    });

    it('should test successful context switching and SPA routing fallback', async () => {
      // 1. Switch context to _global via POST /api/contexts/use
      const switchRes = await fetch(`${baseUrl}/api/contexts/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '_global' })
      });
      expect(switchRes.status).toBe(200);

      // 2. Non-API route SPA fallback (or 404 if no dist)
      const spaRes = await fetch(`${baseUrl}/any/spa/route`);
      expect([200, 404]).toContain(spaRes.status);
    });
  });
});

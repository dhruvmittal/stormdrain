import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { startWebServer } from './server';

describe('Web API Server Resilience & Error Handling', () => {
  let testDir: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sd_web_resilience_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
    
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
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {}
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should return 404 when requesting a non-existent memory ID', async () => {
    const res = await fetch(`${baseUrl}/api/memories/mem_non_existent_12345`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('Not found');
  });

  it('should return 400 when creating memory with empty or invalid payload', async () => {
    const res = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
  });

  it('should return empty array for search queries with no matches', async () => {
    const res = await fetch(`${baseUrl}/api/memories?q=UnmatchedQueryTerm9999`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

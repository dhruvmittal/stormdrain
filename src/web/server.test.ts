import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { startWebServer } from './server';

describe('Web API Server', () => {
  let testDir: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `stormdrain_server_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
    
    server = startWebServer(0);
    
    // Wait for server listening address
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
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should return context list and active context', async () => {
    const res = await fetch(`${baseUrl}/api/contexts`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.active).toBe('_global');
    expect(data.contexts['_global']).toBeDefined();
  });

  it('should reject switching to a non-existent context', async () => {
    const res = await fetch(`${baseUrl}/api/contexts/use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'does-not-exist' })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not exist');
  });

  it('should support full memory CRUD operations', async () => {
    // 1. Create Memory
    const createRes = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'lesson',
        title: 'API Test Memory',
        content: 'Content for API test',
        tags: ['test', 'api']
      })
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    expect(createData.id).toBeDefined();

    const memId = createData.id;

    // 2. Fetch Single Memory
    const getRes = await fetch(`${baseUrl}/api/memories/${memId}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.metadata.title).toBe('API Test Memory');

    // 3. Search Memories via ?q=
    const searchRes = await fetch(`${baseUrl}/api/memories?q=API`);
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.length).toBeGreaterThan(0);

    // 4. Update Memory
    const updateRes = await fetch(`${baseUrl}/api/memories/${memId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated API Memory Title',
        content: 'Updated content'
      })
    });
    expect(updateRes.status).toBe(200);

    // Verify update
    const getUpdatedRes = await fetch(`${baseUrl}/api/memories/${memId}`);
    const getUpdatedData = await getUpdatedRes.json();
    expect(getUpdatedData.metadata.title).toBe('Updated API Memory Title');

    // 5. Delete Memory
    const delRes = await fetch(`${baseUrl}/api/memories/${memId}`, {
      method: 'DELETE'
    });
    expect(delRes.status).toBe(200);

    // 6. Verify 404 after deletion
    const get404Res = await fetch(`${baseUrl}/api/memories/${memId}`);
    expect(get404Res.status).toBe(404);
  });

  it('should validate missing required fields on memory creation', async () => {
    const res = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Missing Type and Content' })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return graph visualization nodes and links', async () => {
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nodes).toBeDefined();
    expect(data.links).toBeDefined();
  });

  it('should get, update, and reset configuration settings', async () => {
    // 1. GET initial config
    const getRes = await fetch(`${baseUrl}/api/config`);
    expect(getRes.status).toBe(200);
    const initialConfig = await getRes.json();
    expect(initialConfig.readTool).toBeDefined();
    expect(initialConfig.readTool.mode).toBe('auto');
    expect(initialConfig.readTool.tokenBudget).toBe(500);

    // 2. POST config update
    const updateRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readTool: {
          tokenBudget: 750,
          mode: 'standalone'
        },
        graph: {
          forwardWeight: 0.88
        }
      })
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.success).toBe(true);
    expect(updateData.settings.readTool.tokenBudget).toBe(750);
    expect(updateData.settings.readTool.mode).toBe('standalone');
    expect(updateData.settings.graph.forwardWeight).toBe(0.88);

    // 3. POST config reset
    const resetRes = await fetch(`${baseUrl}/api/config/reset`, {
      method: 'POST'
    });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.success).toBe(true);
    expect(resetData.settings.readTool.tokenBudget).toBe(500);
    expect(resetData.settings.readTool.mode).toBe('auto');
  });

  it('should handle configuration error states gracefully', async () => {
    // Test config error when sending non-object / invalid body that triggers error
    const errRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json'
    });
    expect(errRes.status).toBeGreaterThanOrEqual(400);
  });
});



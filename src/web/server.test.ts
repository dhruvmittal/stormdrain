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
    expect(initialConfig.graph.performanceThreshold).toBe(500);
    expect(initialConfig.graph.repulsionDistanceMax).toBe(200);
    expect(initialConfig.graph.repulsionTheta).toBe(0.95);
    expect(initialConfig.graph.labelMode).toBe('dynamic');
    expect(initialConfig.graph.labelFilter).toBe('all');
    expect(initialConfig.graph.labelTextBacking).toBe(true);
    expect(initialConfig.graph.labelFocusMode).toBe(false);
    expect(initialConfig.graph.highlightNewest).toBe(false);
    expect(initialConfig.graph.highlightTimeout).toBe(2);
    expect(initialConfig.colors.highlight).toBe('#f59e0b');
 
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
          forwardWeight: 0.88,
          performanceThreshold: 800,
          repulsionDistanceMax: 150,
          repulsionTheta: 0.80,
          labelMode: 'hover-only',
          labelFilter: 'always-show-memories',
          labelTextBacking: false,
          labelFocusMode: true,
          highlightNewest: true,
          highlightTimeout: 5
        },
        colors: {
          highlight: '#ff0000',
          nodes: {
            concept: '#ffffff',
            codemap: '#123456'
          }
        }
      })
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.success).toBe(true);
    expect(updateData.settings.readTool.tokenBudget).toBe(750);
    expect(updateData.settings.readTool.mode).toBe('standalone');
    expect(updateData.settings.graph.forwardWeight).toBe(0.88);
    expect(updateData.settings.graph.performanceThreshold).toBe(800);
    expect(updateData.settings.graph.repulsionDistanceMax).toBe(150);
    expect(updateData.settings.graph.repulsionTheta).toBe(0.80);
    expect(updateData.settings.graph.labelMode).toBe('hover-only');
    expect(updateData.settings.graph.labelFilter).toBe('always-show-memories');
    expect(updateData.settings.graph.labelTextBacking).toBe(false);
    expect(updateData.settings.graph.labelFocusMode).toBe(true);
    expect(updateData.settings.graph.highlightNewest).toBe(true);
    expect(updateData.settings.graph.highlightTimeout).toBe(5);
    expect(updateData.settings.colors.highlight).toBe('#ff0000');
    expect(updateData.settings.colors.nodes.concept).toBe('#ffffff');
    expect(updateData.settings.colors.nodes.codemap).toBe('#123456');
 
    // 2b. GET updated config from separate request
    const getUpdatedRes = await fetch(`${baseUrl}/api/config`);
    const getUpdatedData = await getUpdatedRes.json();
    expect(getUpdatedData.colors.highlight).toBe('#ff0000');
    expect(getUpdatedData.colors.nodes.concept).toBe('#ffffff');
    expect(getUpdatedData.colors.nodes.codemap).toBe('#123456');
    expect(getUpdatedData.graph.performanceThreshold).toBe(800);
    expect(getUpdatedData.graph.labelMode).toBe('hover-only');
    expect(getUpdatedData.graph.labelFocusMode).toBe(true);
    expect(getUpdatedData.graph.highlightNewest).toBe(true);
    expect(getUpdatedData.graph.highlightTimeout).toBe(5);
 
    // 3. POST config reset
    const resetRes = await fetch(`${baseUrl}/api/config/reset`, {
      method: 'POST'
    });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.success).toBe(true);
    expect(resetData.settings.readTool.tokenBudget).toBe(500);
    expect(resetData.settings.readTool.mode).toBe('auto');
    expect(resetData.settings.graph.performanceThreshold).toBe(500);
    expect(resetData.settings.graph.repulsionDistanceMax).toBe(200);
    expect(resetData.settings.graph.repulsionTheta).toBe(0.95);
    expect(resetData.settings.graph.labelMode).toBe('dynamic');
    expect(resetData.settings.graph.labelFilter).toBe('all');
    expect(resetData.settings.graph.labelTextBacking).toBe(true);
    expect(resetData.settings.graph.labelFocusMode).toBe(false);
    expect(resetData.settings.graph.highlightNewest).toBe(false);
    expect(resetData.settings.graph.highlightTimeout).toBe(2);
    expect(resetData.settings.colors.highlight).toBe('#f59e0b');
    expect(resetData.settings.colors.nodes.concept).toBe('#38bdf8');
  });

  it('should handle configuration error states gracefully', async () => {
    const errRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json'
    });
    expect(errRes.status).toBeGreaterThanOrEqual(400);
  });

  it('should return a graph version hash and update on changes', async () => {
    const res = await fetch(`${baseUrl}/api/graph/version`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBeDefined();
    expect(typeof data.version).toBe('string');
    expect(data.version.length).toBe(64);

    const initialVersion = data.version;

    const createRes = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'concept',
        title: 'Test Concept for Versioning',
        content: 'Test content'
      })
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const createdId = createData.id;

    const resAfterCreate = await fetch(`${baseUrl}/api/graph/version`);
    const dataAfterCreate = await resAfterCreate.json();
    expect(dataAfterCreate.version).not.toBe(initialVersion);

    const version2 = dataAfterCreate.version;

    const delRes = await fetch(`${baseUrl}/api/memories/${createdId}`, {
      method: 'DELETE'
    });
    expect(delRes.status).toBe(200);

    const resAfterDelete = await fetch(`${baseUrl}/api/graph/version`);
    const dataAfterDelete = await resAfterDelete.json();
    expect(dataAfterDelete.version).not.toBe(version2);
  });
});





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

  it('should return graph visualization nodes and links with pre-computed modules', async () => {
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nodes).toBeDefined();
    expect(data.links).toBeDefined();

    if (data.nodes.length > 0) {
      for (const node of data.nodes) {
        expect(node.module).toBeDefined();
        expect(typeof node.module).toBe('string');
      }
    }
  });

  it('should return comprehensive dashboard statistics via GET /api/stats', async () => {
    // Create a sample memory to verify stats computation
    await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'warning',
        title: 'Stats Test Warning',
        content: 'Test content for stats warning',
        tags: ['test']
      })
    });

    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const stats = await res.json();

    expect(stats.graphHealthScore).toBeGreaterThan(0);
    expect(stats.counts).toBeDefined();
    expect(stats.counts.warning).toBeGreaterThanOrEqual(1);
    expect(stats.velocity).toBeDefined();
    expect(stats.velocity.last24h).toBeGreaterThanOrEqual(1);
    expect(stats.backlog).toBeDefined();
    expect(stats.codebaseCoverage).toBeDefined();
    expect(Array.isArray(stats.decayWatchlist)).toBe(true);
    expect(Array.isArray(stats.hotspots)).toBe(true);
    expect(Array.isArray(stats.recentActivity)).toBe(true);
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
    expect(initialConfig.graph.attenuateInterModule).toBe(true);
    expect(initialConfig.graph.freezeOutOfScopeNodes).toBe(true);
    expect(initialConfig.graph.interModuleTensionRatio).toBe(0.25);
    expect(initialConfig.graph.memoryChargeStrength).toBe(-140);
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

  it('should return an ETag header on /api/graph and update on changes', async () => {
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const initialETag = res.headers.get('etag');
    expect(initialETag).toBeDefined();
    expect(initialETag!.length).toBeGreaterThan(10);

    // ETag match should return 304 Not Modified
    const cachedRes = await fetch(`${baseUrl}/api/graph`, {
      headers: { 'If-None-Match': initialETag! }
    });
    expect(cachedRes.status).toBe(304);

    // Create memory - ETag should change
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

    const resAfterCreate = await fetch(`${baseUrl}/api/graph`);
    const etagAfterCreate = resAfterCreate.headers.get('etag');
    expect(etagAfterCreate).not.toBe(initialETag);

    // Delete memory - ETag should change again
    const delRes = await fetch(`${baseUrl}/api/memories/${createdId}`, {
      method: 'DELETE'
    });
    expect(delRes.status).toBe(200);

    const resAfterDelete = await fetch(`${baseUrl}/api/graph`);
    const etagAfterDelete = resAfterDelete.headers.get('etag');
    expect(etagAfterDelete).not.toBe(etagAfterCreate);
  });

  it('should recall top memories via /api/recall when no target is specified', async () => {
    // Add a test memory
    await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invariant',
        title: 'Global Thread Safety Rule',
        content: 'Never lock mutex A while holding mutex B.'
      })
    });

    const res = await fetch(`${baseUrl}/api/recall?limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBeGreaterThan(0);
    expect(data.text).toContain('Global Thread Safety Rule');
    expect(data.memories).toBeDefined();
    expect(data.memories.length).toBeGreaterThan(0);
  });

  it('should recall multi-hop neighborhood invariants via /api/recall with target', async () => {
    // Add memory attached to a target file
    await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'warning',
        title: 'GPU Memory Limit',
        content: 'Do not allocate tensors > 8GB in solver.cu',
        targetFile: 'src/solver.cu'
      })
    });

    const res = await fetch(`${baseUrl}/api/recall?target=src/solver.cu`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.target).toBe('src/solver.cu');
    expect(data.count).toBeGreaterThan(0);
    expect(data.text).toContain('GPU Memory Limit');
    expect(data.results).toBeDefined();
    expect(data.results.direct.length).toBeGreaterThan(0);
  });

  it('should return formatted invariant header via /api/invariants', async () => {
    // Add invariant memory for a target file
    await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'warning',
        title: 'Pointer Alignment Constraint',
        content: 'All buffers passed to solver.cu must be 64-byte aligned.',
        targetFile: 'src/solver.cu',
        tags: ['cuda', 'memory']
      })
    });

    const res = await fetch(`${baseUrl}/api/invariants?target=src/solver.cu&tokenBudget=300`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.target).toBe('src/solver.cu');
    expect(data.count).toBeGreaterThan(0);
    expect(data.header).toContain('StormDrain Architectural Invariants & Caller Constraints');
    expect(data.header).toContain('Pointer Alignment Constraint');
  });

  it('should require target parameter for /api/invariants', async () => {
    const res = await fetch(`${baseUrl}/api/invariants`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('target parameter is required');
  });

  it('should reject invalid context names with 400', async () => {
    const res = await fetch(`${baseUrl}/api/memories?context=../../evil`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid context name');
  });

  it('should reject cross-origin mutating requests from unauthorized origins with 403', async () => {
    const res = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://evil-attacker.com'
      },
      body: JSON.stringify({
        type: 'lesson',
        title: 'CSRF Attempt',
        content: 'Malicious payload'
      })
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Cross-origin mutation forbidden');
  });

  it('should allow mutating requests with localhost origin', async () => {
    const res = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5173'
      },
      body: JSON.stringify({
        type: 'lesson',
        title: 'Legit Web UI Call',
        content: 'From Vite dev server'
      })
    });
    expect(res.status).toBe(201);
  });

  it('should promote unpromoted branch memories via POST /api/branches/promote', async () => {
    // Add memory with branch
    await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'concept',
        title: 'Feature Branch Work',
        content: 'Some feature branch concept',
        gitBranch: 'feature/auth-v2',
        isCanonical: false
      })
    });

    const promoteRes = await fetch(`${baseUrl}/api/branches/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/auth-v2' })
    });
    expect(promoteRes.status).toBe(200);
    const promoteData = await promoteRes.json();
    expect(promoteData.success).toBe(true);
    expect(promoteData.branch).toBe('feature/auth-v2');
    expect(promoteData.promotedCount).toBeGreaterThanOrEqual(1);
  });

  it('should initialize context and scaffold AGENTS.md via POST /api/init', async () => {
    const projDir = path.join(testDir, 'init-test-proj');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'index.ts'), 'export const hello = "world";');

    const res = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'init-test-ctx',
        directory: projDir
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.name).toBe('init-test-ctx');
    expect(data.createdCount).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(projDir, 'AGENTS.md'))).toBe(true);
  });

  it('should scan workspace and sync file graph via POST /api/scan', async () => {
    const scanDir = path.join(testDir, 'scan-test-proj');
    fs.mkdirSync(scanDir, { recursive: true });
    fs.writeFileSync(path.join(scanDir, 'calc.py'), 'def add(a, b):\n    return a + b\n');

    const res = await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directory: scanDir
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.createdCount).toBeGreaterThanOrEqual(1);
  });

  it('should prune orphan codemaps via POST /api/prune', async () => {
    const pruneDir = path.join(testDir, 'prune-test-proj');
    fs.mkdirSync(pruneDir, { recursive: true });

    const res = await fetch(`${baseUrl}/api/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directory: pruneDir
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.prunedCount).toBe('number');
  });

  it('should return prompts list via GET /api/prompts and support curate/harvest prompts', async () => {
    // 1. GET /api/prompts
    const listRes = await fetch(`${baseUrl}/api/prompts`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.prompts).toHaveLength(2);
    expect(listData.prompts.map((p: any) => p.name)).toContain('sd_curate');
    expect(listData.prompts.map((p: any) => p.name)).toContain('sd_harvest');

    // 2. POST /api/prompts/curate
    const curateRes = await fetch(`${baseUrl}/api/prompts/curate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 2 })
    });
    expect(curateRes.status).toBe(200);
    const curateData = await curateRes.json();
    expect(curateData.messages).toBeDefined();
    expect(curateData.messages[0].content.text).toContain('StormDrain');

    // 3. POST /api/prompts/harvest
    const harvestRes = await fetch(`${baseUrl}/api/prompts/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3, gitDiff: 'diff --git a/foo.ts b/foo.ts' })
    });
    expect(harvestRes.status).toBe(200);
    const harvestData = await harvestRes.json();
    expect(harvestData.messages).toBeDefined();
    expect(harvestData.messages[0].content.text).toContain('Client Working Copy Diff');
  });

  it('should support depth and max_depth in GET /api/recall', async () => {
    const res = await fetch(`${baseUrl}/api/recall?max_depth=2&limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBeDefined();
  });
});





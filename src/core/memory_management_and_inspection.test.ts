import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { ContextManager } from './context';
import { ConfigManager } from './config';
import { StormDrainMcpServer } from '../mcp';
import { startWebServer } from '../web/server';

describe('Memory Inspection, Management, Cross-Context Search & Surgical Consolidation', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-insp-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-insp-home-'));
    process.env.HOME = homeDir;
    process.env.STORMDRAIN_HOME = path.join(homeDir, '.stormdrain');
    process.env.STORMDRAIN_TEST_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.STORMDRAIN_TEST_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  describe('ContextManager Node Details (sd_get)', () => {
    it('should retrieve full node details for memory nodes including relations', async () => {
      const ctx = new ContextManager('test-get-ctx');
      try {
        const memA = ctx.addMemory(
          'pattern',
          'Circuit Breaker Pattern',
          'Wrap external API calls in circuit breaker to prevent cascading failures.',
          ['resilience', 'api'],
          'manual',
          undefined,
          'src/client.ts'
        );

        const memB = ctx.addMemory(
          'fact',
          'Circuit Breaker Thresholds',
          'Trip circuit breaker after 5 consecutive 5xx errors.',
          ['resilience'],
          'manual',
          undefined,
          undefined,
          undefined,
          [{ target: memA, type: 'supports' }]
        );

        const detailsA = ctx.getNodeDetails(memA);
        expect(detailsA).not.toBeNull();
        expect(detailsA?.id).toBe(memA);
        expect(detailsA?.nodeType).toBe('memory');
        expect(detailsA?.type).toBe('pattern');
        expect(detailsA?.title).toBe('Circuit Breaker Pattern');
        expect(detailsA?.tags).toEqual(['resilience', 'api']);
        expect(detailsA?.content).toContain('Wrap external API calls');
        expect(detailsA?.outgoingRelations.some(r => r.target === 'file_src_client_ts')).toBe(true);
        expect(detailsA?.incomingRelations.some(r => r.source === memB && r.type === 'supports')).toBe(true);

        const detailsB = ctx.getNodeDetails(memB);
        expect(detailsB).not.toBeNull();
        expect(detailsB?.outgoingRelations.some(r => r.target === memA && r.type === 'supports')).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    it('should retrieve full node details for file vertices (codemaps) including attached memories and AST outlines', async () => {
      const ctx = new ContextManager('test-file-node-ctx');
      try {
        const filePath = path.join(tempDir, 'service.ts');
        fs.writeFileSync(filePath, 'export class AuthService { login() {} logout() {} }');
        ctx.syncFileGraph(tempDir);

        // Attach micro-memories to file vertex
        const mem1 = ctx.addMemory('warning', 'Session Invalidation Invariant', 'Always revoke JWT on logout.', ['auth'], 'manual', undefined, 'service.ts');
        const mem2 = ctx.addMemory('fact', 'Token Expiry Window', 'JWT access tokens expire after 15 minutes.', ['auth'], 'manual', undefined, 'service.ts');

        const details = ctx.getNodeDetails('service.ts');
        expect(details).not.toBeNull();
        expect(details?.nodeType).toBe('codemap');
        expect(details?.type).toBe('codemap');
        expect(details?.title).toContain('service.ts');
        expect(details?.filePath).toBe('service.ts');
        expect(details?.attachedMemories?.length).toBe(2);
        expect(details?.attachedMemories?.map(m => m.id)).toContain(mem1);
        expect(details?.attachedMemories?.map(m => m.id)).toContain(mem2);

        // Check AST symbols
        expect(details?.astOutline?.some(s => s.includes('AuthService'))).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    it('should return null for non-existent node IDs', async () => {
      const ctx = new ContextManager('test-null-node-ctx');
      try {
        const details = ctx.getNodeDetails('mem_non_existent_999');
        expect(details).toBeNull();
      } finally {
        await ctx.close();
      }
    });
  });

  describe('ContextManager Cascading Deletion', () => {
    it('should delete a memory and cascade clean outgoing/incoming relations and FTS index', async () => {
      const ctx = new ContextManager('test-del-ctx');
      try {
        const memA = ctx.addMemory('fact', 'Database Connection Pool', 'Pool size defaults to 20 connections.');
        const memB = ctx.addMemory('lesson', 'Pool Exhaustion', 'High concurrency exhausts pool quickly.', [], 'manual', undefined, undefined, undefined, [
          { target: memA, type: 'references' }
        ]);

        expect(ctx.getMemory(memA)).not.toBeNull();
        expect(ctx.getRelations(memA).incoming.length).toBe(1);
        expect(ctx.searchMemories('Connection Pool').length).toBe(1);

        // Delete memA
        ctx.deleteMemory(memA);

        // 1. Memory gone from DB and markdown
        expect(ctx.getMemory(memA)).toBeNull();

        // 2. Relations cascade cleaned
        expect(ctx.getRelations(memA).incoming.length).toBe(0);
        expect(ctx.getRelations(memB).outgoing.length).toBe(0);

        // 3. Removed from FTS search index
        expect(ctx.searchMemories('Connection Pool').length).toBe(0);
      } finally {
        await ctx.close();
      }
    });
  });

  describe('Cross-Context Active + Global Search', () => {
    it('should search active context and include _global context memories seamlessly', async () => {
      const globalCtx = new ContextManager('_global');
      const localCtx = new ContextManager('proj-local');

      try {
        // Add global fact
        globalCtx.addMemory('fact', 'Global NixOS Environment Flag', 'Always run nix-shell with pure mode for reproducibility.', ['nixos', 'environment']);

        // Add local fact
        localCtx.addMemory('fact', 'Local Build Command', 'Run npm run build to compile TypeScript.', ['build']);

        // Search local context with global inclusion enabled
        const searchResults = localCtx.searchMemories('reproducibility', true) as Array<{ title: string; context?: string }>;
        expect(searchResults.length).toBe(1);
        expect(searchResults[0].title).toBe('Global NixOS Environment Flag');
        expect(searchResults[0].context).toBe('_global');

        // Search for local memory
        const localResults = localCtx.searchMemories('TypeScript', true) as Array<{ title: string; context?: string }>;
        expect(localResults.length).toBe(1);
        expect(localResults[0].title).toBe('Local Build Command');
        expect(localResults[0].context).toBe('proj-local');
      } finally {
        await globalCtx.close();
        await localCtx.close();
      }
    });
  });

  describe('Consolidation Candidates & Surgical Synthesis', () => {
    it('should discover consolidation candidate nodes exceeding configurable density threshold', async () => {
      const ctx = new ContextManager('test-candidates-ctx');
      try {
        const filePath = path.join(tempDir, 'payment.ts');
        fs.writeFileSync(filePath, 'export class PaymentService {}');
        ctx.syncFileGraph(tempDir);

        // Add 3 micro-memories to payment.ts
        ctx.addMemory('fact', 'Stripe API Key Rotation', 'Rotate keys every 90 days.', [], 'manual', undefined, 'payment.ts');
        ctx.addMemory('warning', 'Idempotency Key Requirement', 'Always pass idempotency key in charge request.', [], 'manual', undefined, 'payment.ts');
        ctx.addMemory('lesson', 'Webhook Timeout Handling', 'Acknowledge webhooks within 2 seconds.', [], 'manual', undefined, 'payment.ts');

        // Add 1 micro-memory to other file
        const otherPath = path.join(tempDir, 'other.ts');
        fs.writeFileSync(otherPath, 'export class Other {}');
        ctx.syncFileGraph(tempDir);
        ctx.addMemory('fact', 'Other Fact', 'Just one fact.', [], 'manual', undefined, 'other.ts');

        // With threshold 3
        const candidates = ctx.findConsolidationCandidates(3);
        expect(candidates.length).toBe(1);
        expect(candidates[0].target).toBe('file_payment_ts');
        expect(candidates[0].memoryCount).toBe(3);

        // With threshold 4
        const candidatesHigh = ctx.findConsolidationCandidates(4);
        expect(candidatesHigh.length).toBe(0);

        // With threshold 1
        const candidatesLow = ctx.findConsolidationCandidates(1);
        expect(candidatesLow.length).toBe(2);
      } finally {
        await ctx.close();
      }
    });

    it('should support surgical consolidation by passing specific memoryIds', async () => {
      const ctx = new ContextManager('test-surgical-consolidation-ctx');
      try {
        const filePath = path.join(tempDir, 'storage.ts');
        fs.writeFileSync(filePath, 'export class StorageService {}');
        ctx.syncFileGraph(tempDir);

        const m1 = ctx.addMemory('fact', 'S3 Bucket Encryption', 'Enable SSE-S3 encryption.', [], 'manual', undefined, 'storage.ts');
        const m2 = ctx.addMemory('fact', 'S3 Lifecycle Rules', 'Move objects to Glacier after 30 days.', [], 'manual', undefined, 'storage.ts');
        const m3 = ctx.addMemory('warning', 'Local Storage Deprecation', 'Do not write temporary files to local disk.', [], 'manual', undefined, 'storage.ts');

        // Surgically consolidate only m1 and m2, leaving m3 unconsolidated
        const result = ctx.consolidateNeighborhood('storage.ts', [m1, m2]);
        expect(result.consolidatedId).not.toBeNull();
        expect(result.mergedCount).toBe(2);

        // m1 and m2 should be marked superseded
        expect(ctx.getMemory(m1)?.metadata.superseded_by).toBe(result.consolidatedId);
        expect(ctx.getMemory(m2)?.metadata.superseded_by).toBe(result.consolidatedId);

        // m3 should remain ACTIVE and not superseded
        expect(ctx.getMemory(m3)?.metadata.superseded_by || null).toBeNull();
      } finally {
        await ctx.close();
      }
    });
  });

  describe('Global Context Aliasing & Validation', () => {
    it('should map "global" to "_global" and reject creating context named "global"', async () => {
      const config = new ConfigManager();

      // Resolve alias
      expect(config.resolveContext('global', tempDir)).toBe('_global');
      expect(config.resolveContext('_global', tempDir)).toBe('_global');

      // Attempting to add context named "global" should throw
      expect(() => {
        config.addContext('global', [tempDir]);
      }).toThrow(/reserved system alias/i);
    });
  });

  describe('MCP Tools Integration (sd_get, sd_delete, sd_consolidation_candidates, sd_consolidate)', () => {
    it('should execute sd_get, sd_consolidation_candidates, sd_consolidate and sd_delete via MCP', async () => {
      const config = new ConfigManager();
      config.addContext('mcp-integration-ctx', [tempDir]);
      config.setActiveContext('mcp-integration-ctx');

      const mcpServer = new StormDrainMcpServer();
      const serverInstance = (mcpServer as any).server;
      const handler = serverInstance._requestHandlers.get('tools/call');

      // 1. Add memories
      const addRes1 = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_add',
          arguments: {
            type: 'fact',
            title: 'Redis Cache TTL',
            content: 'Set Redis TTL to 3600 seconds.',
            targets: ['src/cache.ts'],
            context: 'mcp-integration-ctx'
          }
        }
      });
      const id1 = addRes1.content[0].text.match(/mem_[a-f0-9]+/)[0];

      const addRes2 = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_add',
          arguments: {
            type: 'warning',
            title: 'Redis Cluster Eviction',
            content: 'Use allkeys-lru eviction policy.',
            targets: ['src/cache.ts'],
            context: 'mcp-integration-ctx'
          }
        }
      });
      const id2 = addRes2.content[0].text.match(/mem_[a-f0-9]+/)[0];

      // 2. sd_get on memory
      const getRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_get',
          arguments: {
            id: id1,
            context: 'mcp-integration-ctx'
          }
        }
      });
      expect(getRes.content[0].text).toContain('Redis Cache TTL');
      expect(getRes.content[0].text).toContain(id1);

      // 3. sd_consolidation_candidates
      const candRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_consolidation_candidates',
          arguments: {
            threshold: 2,
            context: 'mcp-integration-ctx'
          }
        }
      });
      expect(candRes.content[0].text).toContain('src/cache.ts');
      expect(candRes.content[0].text).toContain('attached micro-memories');

      // 4. sd_consolidate with surgical memory_ids
      const consRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_consolidate',
          arguments: {
            target_file: 'src/cache.ts',
            memory_ids: [id1, id2],
            context: 'mcp-integration-ctx'
          }
        }
      });
      expect(consRes.content[0].text).toContain('Successfully consolidated 2 micro-memories');

      // 5. sd_delete on id1
      const delRes = await handler({
        method: 'tools/call',
        params: {
          name: 'sd_delete',
          arguments: {
            id: id1,
            context: 'mcp-integration-ctx'
          }
        }
      });
      expect(delRes.content[0].text).toContain(id1);
      expect(delRes.content[0].text).toContain('Redis Cache TTL');
    });
  });

  describe('REST API Server Endpoints', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
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
    });

    it('should support GET /api/nodes/:id, GET /api/consolidation-candidates, and POST /api/consolidate', async () => {
      // 1. Create memories
      const createRes1 = await fetch(`${baseUrl}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          title: 'GraphQL Query Depth Limit',
          content: 'Max query depth is limited to 5 levels.',
          targets: ['src/graphql/schema.ts']
        })
      });
      expect(createRes1.status).toBe(201);
      const { id: memId1 } = await createRes1.json() as any;

      const createRes2 = await fetch(`${baseUrl}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'warning',
          title: 'GraphQL Complexity Calculation',
          content: 'Reject queries with complexity score exceeding 1000.',
          targets: ['src/graphql/schema.ts']
        })
      });
      expect(createRes2.status).toBe(201);
      const { id: memId2 } = await createRes2.json() as any;

      // 2. GET /api/nodes/:id
      const getNodeRes = await fetch(`${baseUrl}/api/nodes/${memId1}`);
      expect(getNodeRes.status).toBe(200);
      const nodeDetails = await getNodeRes.json() as any;
      expect(nodeDetails.id).toBe(memId1);
      expect(nodeDetails.title).toBe('GraphQL Query Depth Limit');

      // 3. GET /api/consolidation-candidates
      const getCandRes = await fetch(`${baseUrl}/api/consolidation-candidates?threshold=1`);
      expect(getCandRes.status).toBe(200);
      const candidates = await getCandRes.json() as any[];
      expect(candidates.length).toBeGreaterThan(0);

      // 4. POST /api/consolidate
      const postConsRes = await fetch(`${baseUrl}/api/consolidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'src/graphql/schema.ts',
          memoryIds: [memId1, memId2]
        })
      });
      expect(postConsRes.status).toBe(200);
      const consJson = await postConsRes.json() as any;
      expect(consJson.success).toBe(true);

      // 5. DELETE /api/memories/:id
      const delRes = await fetch(`${baseUrl}/api/memories/${memId1}`, {
        method: 'DELETE'
      });
      expect(delRes.status).toBe(200);
    });
  });
});

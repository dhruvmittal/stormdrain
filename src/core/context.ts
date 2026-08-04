import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { ConfigManager } from './config';
import { initDb } from '../db/schema';
import { syncMemoryToDb, deleteMemoryFromDb } from '../db/sync';
import { parseMemory, serializeMemory, createMemoryMetadata } from './memory';
import { GitManager } from './git';
import { Memory, MemoryType } from '../types';
import { getContextDbPath, getContextMemoriesPath, ensureDirectories } from '../utils/paths';

export class ContextManager {
  public readonly name: string;
  private db: Database.Database;
  private git: GitManager;
  private memoriesPath: string;

  constructor(name: string) {
    this.name = name;
    ensureDirectories(name);
    
    this.memoriesPath = getContextMemoriesPath(name);
    const dbPath = getContextDbPath(name);
    
    this.db = initDb(dbPath);
    this.git = new GitManager(name);
  }

  public getDb(): Database.Database {
    return this.db;
  }

  private getSafeMemPath(id: string): string {
    const safeId = path.basename(id, '.md');
    return path.join(this.memoriesPath, `${safeId}.md`);
  }

  public addMemory(type: MemoryType, title: string, content: string, tags: string[] = [], source: Memory['metadata']['source'] = 'manual'): string {
    const id = `mem_${crypto.randomBytes(6).toString('hex')}`;
    
    const memory: Memory = {
      metadata: createMemoryMetadata(id, type, title, this.name, tags, [], source),
      content
    };

    this.saveMemory(memory, `[stormdrain] add: ${type} "${title}"`);
    return id;
  }

  public updateMemory(id: string, content?: string, title?: string, tags?: string[], type?: MemoryType) {
    const memory = this.getMemory(id);
    if (!memory) throw new Error(`Memory ${id} not found.`);

    if (content !== undefined) memory.content = content;
    if (title !== undefined) memory.metadata.title = title;
    if (tags !== undefined) memory.metadata.tags = tags;
    if (type !== undefined) memory.metadata.type = type;
    
    memory.metadata.updated = new Date().toISOString();

    this.saveMemory(memory, `[stormdrain] update: ${memory.metadata.type} "${memory.metadata.title}"`);
  }

  public getMemory(id: string): Memory | null {
    const memPath = this.getSafeMemPath(id);
    if (!fs.existsSync(memPath)) return null;

    const content = fs.readFileSync(memPath, 'utf8');
    return parseMemory(content);
  }

  public deleteMemory(id: string) {
    const memPath = this.getSafeMemPath(id);
    if (fs.existsSync(memPath)) {
      const memory = this.getMemory(id);
      fs.unlinkSync(memPath);
      deleteMemoryFromDb(this.db, id);
      this.git.scheduleCommit(`[stormdrain] delete: memory ${id} "${memory?.metadata.title || ''}"`);
    }
  }

  private saveMemory(memory: Memory, commitMsg: string) {
    const memPath = this.getSafeMemPath(memory.metadata.id);
    fs.writeFileSync(memPath, serializeMemory(memory));
    syncMemoryToDb(this.db, memory);
    this.git.scheduleCommit(commitMsg);
  }

  public searchMemories(query: string) {
    // FTS5 query
    const stmt = this.db.prepare(`
      SELECT m.*, fts.content as content_snippet
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `);
    
    // Sanitize query to avoid FTS5 syntax errors
    const safeQuery = query
      .split(/\s+/)
      .map(term => term.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F]/g, ''))
      .filter(Boolean)
      .map(term => `"${term}"`)
      .join(' AND ');

    if (!safeQuery) return [];
    
    try {
      return stmt.all(safeQuery);
    } catch {
      return [];
    }
  }

  public recallTopMemories(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      WHERE expires IS NULL OR expires > datetime('now')
      ORDER BY confidence DESC, accessed DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  public markAccessed(id: string) {
    const memory = this.getMemory(id);
    if (memory) {
      memory.metadata.accessed = new Date().toISOString();
      memory.metadata.access_count += 1;
      
      // Access boost logic (simple implementation)
      if (memory.metadata.confidence < 1.0) {
        memory.metadata.confidence = Math.min(1.0, memory.metadata.confidence + 0.05);
      }

      this.saveMemory(memory, `[stormdrain] internal: access memory ${id}`);
    }
  }

  public async close() {
    this.db.close();
    await this.git.commit();
  }
}

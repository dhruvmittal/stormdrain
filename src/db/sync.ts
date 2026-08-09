import Database from 'better-sqlite3';
import { Memory } from '../types';

export const syncMemoryToDb = (db: Database.Database, memory: Memory) => {
  const m = memory.metadata;
  
  const insertMemory = db.prepare(`
    INSERT INTO memories (id, type, title, context, confidence, created, updated, accessed, access_count, source, expires, superseded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type,
      title=excluded.title,
      context=excluded.context,
      confidence=excluded.confidence,
      updated=excluded.updated,
      accessed=excluded.accessed,
      access_count=excluded.access_count,
      source=excluded.source,
      expires=excluded.expires,
      superseded_by=excluded.superseded_by
  `);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tags (memory_id, tag) VALUES (?, ?)
  `);

  const deleteTags = db.prepare(`
    DELETE FROM tags WHERE memory_id = ?
  `);

  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO relations (source_id, target_id, type) VALUES (?, ?, ?)
  `);

  const deleteRelations = db.prepare(`
    DELETE FROM relations WHERE source_id = ?
  `);

  const insertFts = db.prepare(`
    INSERT INTO memories_fts (id, title, content) VALUES (?, ?, ?)
  `);

  const deleteFts = db.prepare(`
    DELETE FROM memories_fts WHERE id = ?
  `);

  const tx = db.transaction(() => {
    // 1. Upsert memory metadata
    insertMemory.run(
      m.id, m.type, m.title, m.context, m.confidence, m.created, m.updated, m.accessed, m.access_count, m.source, m.expires, m.superseded_by
    );

    // 2. Update tags
    deleteTags.run(m.id);
    for (const tag of m.tags) {
      insertTag.run(m.id, tag);
    }

    // 3. Update relations
    deleteRelations.run(m.id);
    for (const rel of m.relations) {
      insertRelation.run(m.id, rel.target, rel.type);
    }

    // 4. Update FTS
    deleteFts.run(m.id);
    insertFts.run(m.id, m.title, memory.content);
  });

  tx();
};

export const deleteMemoryFromDb = (db: Database.Database, id: string) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    db.prepare('DELETE FROM relations WHERE target_id = ?').run(id);
  });
  tx();
};


import Database from 'better-sqlite3';

export const initDb = (dbPath: string): Database.Database => {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      context TEXT NOT NULL,
      confidence REAL NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      accessed TEXT NOT NULL,
      access_count INTEGER NOT NULL,
      source TEXT NOT NULL,
      expires TEXT,
      superseded_by TEXT
    );
  `);

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(memory_id, tag)
    );
  `);

  // Relations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, type)
    );
  `);

  // FTS5 table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tokenize='trigram'
    );
  `);

  return db;
};

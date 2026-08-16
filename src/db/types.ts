import { MemoryType, RelationType } from '../types';

export interface MemoryDbRow {
  id: string;
  type: MemoryType;
  title: string;
  context: string;
  confidence: number;
  created: string;
  updated: string;
  accessed: string;
  access_count: number;
  source: 'conversation' | 'indexer' | 'manual' | 'promotion';
  expires: string | null;
  superseded_by: string | null;
  content: string;
  file_path?: string | null;
  ast_outline?: string | null;
}

export interface TagDbRow {
  memory_id: string;
  tag: string;
}

export interface RelationDbRow {
  source_id: string;
  target_id: string;
  type: RelationType;
}

export interface FtsDbRow {
  id: string;
  title: string;
  content: string;
  tags: string;
}

export interface GraphHopsDbRow {
  node_id: string;
  depth: number;
  direction: 'direct' | 'upstream_caller' | 'downstream_dependency';
}

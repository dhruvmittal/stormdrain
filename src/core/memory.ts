import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Memory, MemoryMetadata, MemoryType } from '../types';

export const parseMemory = (fileContent: string): Memory => {
  const match = fileContent.match(/^(?:---[\r\n]+)([\s\S]*?)(?:[\r\n]+---[\r\n]+)([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid memory format: Missing YAML frontmatter');
  }

  const frontmatterStr = match[1];
  const content = match[2];
  
  const metadata = yaml.parse(frontmatterStr) as MemoryMetadata;
  return { metadata, content };
};

export const serializeMemory = (memory: Memory): string => {
  const frontmatterStr = yaml.stringify(memory.metadata);
  return `---\n${frontmatterStr}---\n${memory.content}`;
};

export const createMemoryMetadata = (
  id: string,
  type: MemoryType,
  title: string,
  context: string,
  tags: string[] = [],
  relations: any[] = [],
  source: 'conversation' | 'indexer' | 'manual' | 'promotion' = 'manual'
): MemoryMetadata => {
  const now = new Date().toISOString();
  return {
    id,
    type,
    title,
    context,
    tags,
    confidence: 1.0,
    created: now,
    updated: now,
    accessed: now,
    access_count: 0,
    source,
    expires: null,
    superseded_by: null,
    relations
  };
};

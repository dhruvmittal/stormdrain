import { describe, it, expect } from 'vitest';
import { parseMemory, serializeMemory, createMemoryMetadata } from './memory';

describe('Memory Parser and Serializer', () => {
  it('should parse a valid memory markdown string', () => {
    const raw = `---
id: mem_123
type: lesson
title: Test Title
context: global
tags:
  - testing
confidence: 0.9
created: '2026-08-01T00:00:00.000Z'
updated: '2026-08-01T00:00:00.000Z'
accessed: '2026-08-01T00:00:00.000Z'
access_count: 5
source: manual
expires: null
superseded_by: null
relations: []
---

This is the content.`;

    const memory = parseMemory(raw);
    expect(memory.metadata.id).toBe('mem_123');
    expect(memory.metadata.type).toBe('lesson');
    expect(memory.metadata.title).toBe('Test Title');
    expect(memory.metadata.tags).toContain('testing');
    expect(memory.content.trim()).toBe('This is the content.');
  });

  it('should throw an error for invalid memory format without frontmatter', () => {
    const raw = `This is just some content without YAML.`;
    expect(() => parseMemory(raw)).toThrow('Invalid memory format');
  });

  it('should serialize a memory object back into markdown string', () => {
    const memory = {
      metadata: createMemoryMetadata('mem_abc', 'fact', 'A fact', 'global', ['fact_tag']),
      content: 'Here is the fact.'
    };
    
    // Override dates so it's predictable
    memory.metadata.created = '2026-08-01T00:00:00.000Z';
    memory.metadata.updated = '2026-08-01T00:00:00.000Z';
    memory.metadata.accessed = '2026-08-01T00:00:00.000Z';

    const serialized = serializeMemory(memory);
    expect(serialized).toContain('id: mem_abc');
    expect(serialized).toContain('type: fact');
    expect(serialized).toContain('title: A fact');
    expect(serialized).toContain('Here is the fact.');
    
    // Re-parse to ensure consistency
    const reParsed = parseMemory(serialized);
    expect(reParsed.metadata.id).toBe(memory.metadata.id);
    expect(reParsed.content.trim()).toBe(memory.content);
  });
});

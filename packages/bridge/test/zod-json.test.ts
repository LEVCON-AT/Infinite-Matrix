import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src/util/zod-json.js';

describe('zodToJsonSchema', () => {
  it('konvertiert einfaches Objekt', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.required).toEqual(['name', 'age']);
    expect((json.properties as Record<string, unknown>).name).toEqual({ type: 'string' });
    expect((json.properties as Record<string, unknown>).age).toEqual({ type: 'number' });
  });

  it('markiert optionale Felder nicht als required', () => {
    const schema = z.object({
      label: z.string(),
      alias: z.string().optional(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.required).toEqual(['label']);
  });

  it('konvertiert enum', () => {
    const schema = z.enum(['a', 'b', 'c']);
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('string');
    expect(json.enum).toEqual(['a', 'b', 'c']);
  });

  it('konvertiert array', () => {
    const schema = z.array(z.string());
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('array');
    expect(json.items).toEqual({ type: 'string' });
  });

  it('übernimmt descriptions', () => {
    const schema = z.string().describe('Ein Name');
    const json = zodToJsonSchema(schema);
    expect(json.description).toBe('Ein Name');
  });

  it('konvertiert defaults', () => {
    const schema = z.number().default(42);
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('number');
    expect(json.default).toBe(42);
  });

  it('konvertiert verschachteltes Objekt', () => {
    const schema = z.object({
      filter: z.object({
        tag: z.string().optional(),
      }),
    });
    const json = zodToJsonSchema(schema);
    const filter = (json.properties as Record<string, Record<string, unknown>>).filter;
    expect(filter.type).toBe('object');
    expect((filter.properties as Record<string, unknown>).tag).toEqual({ type: 'string' });
  });
});

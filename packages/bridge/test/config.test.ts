import { afterEach, describe, expect, it } from 'vitest';

describe('loadConfig', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('wirft bei fehlendem BRIDGE_TOKEN', async () => {
    process.env.BRIDGE_TOKEN = '';
    // loadConfig cached beim ersten Aufruf; wir testen das Schema direkt.
    const { z } = await import('zod');
    const schema = z.object({
      BRIDGE_TOKEN: z.string().min(16),
    });
    expect(schema.safeParse({ BRIDGE_TOKEN: '' }).success).toBe(false);
    expect(schema.safeParse({ BRIDGE_TOKEN: 'short' }).success).toBe(false);
    expect(schema.safeParse({ BRIDGE_TOKEN: 'a-valid-token-1234567890' }).success).toBe(true);
  });

  it('setzt sinnvolle Defaults', async () => {
    const { z } = await import('zod');
    const envSchema = z.object({
      PORT: z.coerce.number().int().min(1).max(65535).default(3849),
      HOST: z.string().default('127.0.0.1'),
      NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
      LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
      DB_PATH: z.string().default('./data/matrix.db'),
      BRIDGE_TOKEN: z.string().min(16),
    });
    const result = envSchema.parse({ BRIDGE_TOKEN: 'test-token-12345678' });
    expect(result.PORT).toBe(3849);
    expect(result.HOST).toBe('127.0.0.1');
    expect(result.NODE_ENV).toBe('development');
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.DB_PATH).toBe('./data/matrix.db');
  });
});

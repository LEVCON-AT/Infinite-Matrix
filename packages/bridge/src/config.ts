import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3849),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DB_PATH: z.string().default('./data/matrix.db'),
  BRIDGE_TOKEN: z.string().min(16, 'BRIDGE_TOKEN muss mindestens 16 Zeichen haben'),
  // CORS-Allowlist (ASVS V1.14.1). Komma-getrennt, z.B.
  // "https://matrix.levcon.at,http://localhost:3848". Falls leer/
  // unset, bleibt es auf der bisherigen reflektiv-true-Variante (nur
  // im Dev-Modus tolerierbar).
  CORS_ORIGINS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  _config = result.data;
  return _config;
}

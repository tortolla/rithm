import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://rithm:rithm@localhost:5432/rithm'),
  BOT_TOKEN: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  DEV_TELEGRAM_ID: z.coerce.number().int().positive().default(100000001),
  DEV_TELEGRAM_NAME: z.string().default('Настя'),
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true')
});

export const config = schema.parse(process.env);

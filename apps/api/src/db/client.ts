import postgres from 'postgres';
import { config } from '../config.js';

export const sql = postgres(config.DATABASE_URL, {
  max: config.NODE_ENV === 'test' ? 1 : 10,
  transform: postgres.camel
});

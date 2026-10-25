import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from './client.js';

export async function migrate() {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = resolve(process.cwd(), 'apps/api/src/db/migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const [existing] = await sql`SELECT name FROM schema_migrations WHERE name = ${file}`;
    if (existing) continue;
    const source = await readFile(resolve(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`Applied migration ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => sql.end()).catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
}

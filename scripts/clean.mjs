import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist');
if (!target.endsWith('/dist')) throw new Error('Refusing to clean an unexpected path');
rmSync(target, { recursive: true, force: true });

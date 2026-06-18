import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema/index.js';

// Absolute path so the data directory is the same regardless of which
// package's CWD this is imported from (gateway vs. db scripts).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDataDir = path.join(packageRoot, 'pgdata');

export const dataDir = process.env.DATABASE_URL ?? defaultDataDir;

export const pglite = new PGlite(dataDir);
export const db = drizzle(pglite, { schema });

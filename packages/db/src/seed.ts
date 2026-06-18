import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { generateApiKey } from './apiKey.js';
import { db } from './client.js';
import { runMigrations } from './migrate.js';
import { apiKeys, users } from './schema/index.js';

const email = process.argv[2] ?? 'dev@tunnelx.local';
const password = process.argv[3] ?? 'changeme';

await runMigrations();

const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
let user = existing[0];

if (!user) {
  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await db.insert(users).values({ email, passwordHash }).returning();
  user = inserted[0]!;
  console.log(`Created user ${email} (password: ${password})`);
} else {
  console.log(`Using existing user ${email}`);
}

const { rawKey, keyPrefix, keyHash } = generateApiKey();

await db.insert(apiKeys).values({
  userId: user.id,
  name: 'seed key',
  keyPrefix,
  keyHash,
});

console.log('');
console.log('API key (save this — it will not be shown again):');
console.log(`  ${rawKey}`);
console.log('');
console.log('Use it with the CLI:');
console.log(`  pnpm --filter @tunnelx/cli dev -- http 3000 --api-key ${rawKey}`);

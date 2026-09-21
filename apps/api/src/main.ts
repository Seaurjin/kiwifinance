/**
 * Dev entry point.
 *
 * Opens an in-memory ledger and seeds it, so `pnpm dev` gives a running API
 * with data in it and nothing to configure. Point KIWI_DB at a file to keep
 * the data between restarts.
 */

import { LedgerStore, seedDemo } from '@kiwi/store';
import { buildServer } from './server.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

const store = LedgerStore.open(process.env['KIWI_DB'] ?? ':memory:');
const seeded = seedDemo(store, today());

const app = buildServer({ store, today });
const port = Number(process.env['PORT'] ?? 8787);

await app.listen({ port, host: '0.0.0.0' });
console.log(`Kiwi API on http://localhost:${port}  ledger=${seeded.ledgerId}`);

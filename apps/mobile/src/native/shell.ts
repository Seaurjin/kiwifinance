/**
 * The bridge to the parts of iOS that are not React Native.
 *
 * The Share Extension, the Shortcuts intents and the widget each run in their
 * own process and cannot see this app's state. What they can see is an App
 * Group container, and this module is what puts things in it: where the API
 * is, which ledger and account to use, and the last figure the engine
 * returned so the widget has something to show offline.
 *
 * It also drains the outbox — captures the extension took while it had no
 * network. Those are re-read through the same API the capture bar uses, so
 * they land in the review queue rather than straight in the ledger.
 *
 * Every function here is a no-op when the native module is absent (Expo Go,
 * Android, a simulator running the JS-only build), so nothing above it has to
 * know whether the shell exists.
 */

import type { KiwiClient } from '@kiwi/client';
import type { FactSet } from '@kiwi/report-spec';
import { NativeModules, Platform } from 'react-native';

export interface PendingCapture {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  fileUri?: string;
  sourceApp?: string;
  createdAt: string;
}

interface KiwiBridgeModule {
  setConfig(baseUrl: string, ledgerId: string, accountId: string): Promise<void>;
  writeSnapshot(snapshot: {
    allowanceMinor: number | null;
    currency: string;
    pendingCount: number;
    asOf: string;
    unavailableReason?: string;
  }): Promise<void>;
  pendingCaptures(): Promise<PendingCapture[]>;
  removePendingCapture(id: string): Promise<void>;
}

const bridge: KiwiBridgeModule | undefined = (
  NativeModules as { KiwiBridge?: KiwiBridgeModule }
).KiwiBridge;

/** True only in a build that has the native targets compiled in. */
export const hasNativeShell = Platform.OS === 'ios' && bridge !== undefined;

export interface ShellSyncResult {
  /** Text captures that were read and written to the review queue. */
  committed: number;
  /** Screenshots waiting for an extractor that can read an image. */
  waitingImages: number;
}

const EMPTY: ShellSyncResult = { committed: 0, waitingImages: 0 };

/**
 * Publishes what the extensions need and drains what they left behind.
 *
 * Call it after a load: it is cheap when there is nothing waiting, and it is
 * the only thing that keeps the widget's figure in step with the app's.
 */
export async function syncNativeShell(
  client: KiwiClient,
  options: { apiUrl: string; ledgerId: string; accountId: string; pendingCount: number },
): Promise<ShellSyncResult> {
  if (bridge === undefined) return EMPTY;

  try {
    await bridge.setConfig(options.apiUrl, options.ledgerId, options.accountId);
    await publishAllowance(client, options.ledgerId, options.pendingCount);
    return await drainOutbox(client, options.ledgerId, options.accountId);
  } catch {
    // The shell is a convenience. A failure here must never stop the screen
    // the user is actually looking at.
    return EMPTY;
  }
}

/**
 * Caches the daily allowance for the widget.
 *
 * It reads the figure out of the budget report's fact set and forwards it
 * untouched — value, currency, the engine's own reason when it is undefined,
 * and the instant it was computed. Nothing is recomputed on the device, so a
 * cached figure can be stale but cannot be wrong.
 */
async function publishAllowance(
  client: KiwiClient,
  ledgerId: string,
  pendingCount: number,
): Promise<void> {
  if (bridge === undefined) return;

  const { factSet }: { factSet: FactSet } = await client.standardReport(ledgerId, 'budget_replan');
  const allowance = factSet.blocks
    .flatMap((block) => block.facts)
    .find((fact) => fact.metric === 'daily_allowance');

  if (allowance === undefined || allowance.kind !== 'scalar') return;

  await bridge.writeSnapshot({
    allowanceMinor: allowance.value,
    currency: allowance.currency ?? '',
    pendingCount,
    asOf: factSet.generatedAt,
    ...(allowance.unavailableReason !== undefined
      ? { unavailableReason: allowance.unavailableReason }
      : {}),
  });
}

/**
 * Reads the captures the extension could not send.
 *
 * Text goes through extract → commit, exactly as if it had been typed into
 * the capture bar, which means the server decides what needs confirming.
 * Images stay put: reading one needs a model the API does not have yet, and
 * silently dropping them would be worse than making the user wait.
 */
async function drainOutbox(
  client: KiwiClient,
  ledgerId: string,
  accountId: string,
): Promise<ShellSyncResult> {
  if (bridge === undefined) return EMPTY;

  const captures = await bridge.pendingCaptures();
  let committed = 0;
  let waitingImages = 0;

  for (const capture of captures) {
    if (capture.kind !== 'text' || capture.text === undefined || accountId === '') {
      if (capture.kind === 'image') waitingImages += 1;
      continue;
    }
    try {
      const { drafts, extractedBy } = await client.extract(ledgerId, capture.text);
      if (drafts.length > 0) {
        await client.commit(ledgerId, { accountId, source: 'share', extractedBy, drafts });
        committed += drafts.length;
      }
      // Removed either way: an amountless note would otherwise be retried for
      // ever. It is gone from the outbox, not from the ledger — it never
      // reached the ledger.
      await bridge.removePendingCapture(capture.id);
    } catch {
      // Leave it in the outbox and try again next time.
    }
  }

  return { committed, waitingImages };
}

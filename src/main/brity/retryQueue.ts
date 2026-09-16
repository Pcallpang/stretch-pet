import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrityMessage } from './ingestClient';

export interface QueuedMessage {
  msg: BrityMessage;
  firstSeenAt: number;
}

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function enqueue(queue: QueuedMessage[], msg: BrityMessage, now: number): QueuedMessage[] {
  return [...queue, { msg, firstSeenAt: now }];
}

export function pruneExpired(queue: QueuedMessage[], now: number, maxAgeMs: number): QueuedMessage[] {
  return queue.filter((item) => now - item.firstSeenAt < maxAgeMs);
}

function queueFilePath(): string {
  return path.join(app.getPath('userData'), 'messenger-alert-retry-queue.json');
}

export function loadQueueFile(): QueuedMessage[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFilePath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueueFile(queue: QueuedMessage[]): void {
  try {
    fs.writeFileSync(queueFilePath(), JSON.stringify(queue));
  } catch (err) {
    console.error('[stretch-pet] 재시도 큐 저장 실패:', err);
  }
}

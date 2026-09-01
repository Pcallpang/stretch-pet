export class TimerScheduler {
  private timeoutId: NodeJS.Timeout | null = null;

  schedule(ms: number, callback: () => void): void {
    this.cancel();
    this.timeoutId = setTimeout(callback, ms);
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

export function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}

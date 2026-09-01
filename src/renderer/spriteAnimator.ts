export class SpriteAnimator {
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly frames: string[],
    private readonly fps: number,
    private readonly onFrame: (src: string) => void,
  ) {
    if (frames.length === 0) {
      throw new Error('SpriteAnimator requires at least one frame');
    }
  }

  start(): void {
    this.stop();
    this.index = 0;
    this.onFrame(this.frames[this.index]);
    if (this.frames.length === 1) return;
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.onFrame(this.frames[this.index]);
    }, 1000 / this.fps);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

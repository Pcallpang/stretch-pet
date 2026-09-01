export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
}

declare global {
  interface Window {
    petAPI: {
      setIgnoreMouseEvents(ignore: boolean): void;
      onTimerElapsed(callback: () => void): void;
      onCooldownElapsed(callback: () => void): void;
      notifyStretchComplete(): void;
      notifyStretchSkip(): void;
      getSettings(): Promise<PetSettings>;
    };
  }
}

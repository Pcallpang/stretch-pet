export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
  pinned: boolean;
}

declare global {
  interface Window {
    petAPI: {
      setIgnoreMouseEvents(ignore: boolean): void;
      onTimerElapsed(callback: () => void): void;
      onCooldownElapsed(callback: () => void): void;
      onAlertTimeout(callback: () => void): void;
      notifyStretchComplete(): void;
      notifyStretchSkip(): void;
      notifyStretchStart(): void;
      getSettings(): Promise<PetSettings>;
      showPetContextMenu(): void;
      onForceStretch(callback: () => void): void;
      onShowSettingsPanel(callback: (focusMinutes: number) => void): void;
      setFocusMinutes(minutes: number): void;
      getMinutesUntilNextStretch(): Promise<number | null>;
      onPinnedChanged(callback: (pinned: boolean) => void): void;
    };
  }
}

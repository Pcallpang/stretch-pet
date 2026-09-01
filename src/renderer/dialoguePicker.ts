import { DIALOGUES, DialogueKey } from './dialogues.js';

export function pickDialogue(key: DialogueKey, random: () => number = Math.random): string {
  const lines = DIALOGUES[key];
  const index = Math.floor(random() * lines.length);
  return lines[index];
}

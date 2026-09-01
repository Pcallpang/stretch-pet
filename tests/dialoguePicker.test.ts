import { describe, it, expect } from 'vitest';
import { pickDialogue } from '../src/renderer/dialoguePicker';

describe('pickDialogue', () => {
  it('returns the only line when there is exactly one', () => {
    expect(pickDialogue('complete')).toBe('수고했다. 다시 일해라.');
  });

  it('uses the injected random function to choose an index', () => {
    expect(pickDialogue('alert_start', () => 0)).toBe('알빠임? 그래도 척추는 펴라.');
    expect(pickDialogue('alert_start', () => 0.99)).toBe('거북목 상태로 일하면 퇴근도 늦어진다.');
  });
});

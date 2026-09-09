import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => any>,
  send: vi.fn(), menu: [] as any[], tray: null as any,
  settings: { focusMinutes: 50 }, options: null as any,
}));
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve(), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: class {
    webContents = { send: mock.send };
    constructor(options: unknown) { mock.options = options; }
    setIgnoreMouseEvents() {} loadFile() {} isDestroyed() { return false; } setBounds() {}
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 40, y: 20, width: 1200, height: 800 } }), on: vi.fn() },
  ipcMain: {
    on: (key: string, cb: any) => { mock.handlers[key] = cb; },
    handle: (key: string, cb: any) => { mock.handlers[key] = cb; },
  },
  Menu: { buildFromTemplate: (menu: any[]) => { mock.menu = menu; return { popup() {} }; } },
}));
vi.mock('../src/main/settings', () => ({
  getSettings: () => mock.settings,
  setSettings: (settings: any) => Object.assign(mock.settings, settings),
}));
vi.mock('../src/main/tray', () => ({
  createTray: (callbacks: any) => { mock.tray = callbacks; }, refreshTray: vi.fn(),
}));
const emit = (key: string, value?: any) => mock.handlers[key]({}, value);
const remaining = () => mock.handlers['get-minutes-until-next-stretch']();
const manual = () => { emit('show-pet-context-menu'); mock.menu[0].click(); emit('stretch-started'); };
const minutes = (n: number) => vi.advanceTimersByTime(n * 60000);
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); mock.send.mockClear(); mock.settings = { focusMinutes: 50 };
  await import('../src/main/main');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('main process timer integration', () => {
  it('uses work area origin and keeps background animation active', () => {
    expect(mock.options).toMatchObject({ x: 40, y: 20, webPreferences: { backgroundThrottling: false } });
  });
  it('applies tray interval immediately during focus', () => {
    minutes(10); mock.tray.onFocusMinutesChange(25);
    expect(remaining()).toBe(25); minutes(25);
    expect(mock.send).toHaveBeenCalledWith('timer-elapsed');
  });
  it('cancels old cooldown when manually starting again', () => {
    manual(); emit('stretch-skip'); minutes(1); manual(); mock.send.mockClear(); minutes(2);
    expect(mock.send).not.toHaveBeenCalledWith('cooldown-elapsed'); expect(remaining()).toBeNull();
  });
  it('changes settings during stretch without starting another timer', () => {
    manual(); emit('set-focus-minutes', 5); minutes(6);
    expect(remaining()).toBeNull(); expect(mock.send).not.toHaveBeenCalledWith('timer-elapsed');
    emit('stretch-complete'); expect(remaining()).toBe(7); minutes(2); expect(remaining()).toBe(5);
  });
  it('preserves cooldown when changing settings and ignores duplicate completion', () => {
    manual(); emit('stretch-skip'); minutes(1); emit('stretch-complete'); emit('set-focus-minutes', 25);
    expect(remaining()).toBe(26); minutes(1); expect(remaining()).toBe(25);
  });
  it('times out an unanswered alert and resumes with updated settings', () => {
    minutes(50); emit('set-focus-minutes', 25); expect(remaining()).toBeNull(); minutes(2);
    expect(mock.send).toHaveBeenCalledWith('alert-timeout'); expect(remaining()).toBe(25);
  });
  it('ignores malformed focus settings', () => {
    emit('set-focus-minutes', NaN); emit('set-focus-minutes', Infinity); emit('set-focus-minutes', '5');
    expect(remaining()).toBe(50);
  });
});

 describe('character context menu', () => {
  it('saves selection, marks the selected item and leaves the focus countdown running', () => {
    minutes(10);
    emit('show-pet-context-menu');
    const submenu = mock.menu.find(item => item.submenu)?.submenu;
    expect(submenu).toHaveLength(4);
    submenu[3].click();
    expect(mock.settings).toMatchObject({ character: 'godmiyo' });
    expect(mock.send).toHaveBeenCalledWith('character-changed', 'godmiyo');
    expect(remaining()).toBe(40);
    emit('show-pet-context-menu');
    expect(mock.menu.find(item => item.submenu).submenu.map((item: any) => item.checked))
      .toEqual([false, false, false, true]);
  });
  it('does not reset an active stretch when changing character', () => {
    manual(); emit('show-pet-context-menu');
    mock.menu.find(item => item.submenu).submenu[0].click();
    expect(remaining()).toBeNull();
    emit('stretch-complete'); expect(remaining()).toBe(52);
  });
});

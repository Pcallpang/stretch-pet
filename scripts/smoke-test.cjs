// Run with: node scripts/smoke-test.cjs [path/to/app.asar] (build first).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'stretch-pet-smoke-'));
  const env = { ...process.env, STRETCH_PET_SMOKE_DATA: data,
    STRETCH_PET_SMOKE_APP: path.resolve(process.argv[2] || path.join(__dirname, '..')) };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
  console.log(result.stdout || '');
  console.error(result.stderr || '');
  if (result.error) console.error(result.error);
  // Isolated settings are intentionally kept in the OS temp directory for diagnostics.
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, Menu } = require('electron');
let petMenu;
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => {
  const menu = buildMenu(template);
  if (template.some(item => item.submenu)) { petMenu = menu; menu.popup = () => {}; }
  return menu;
};
const assert = require('node:assert/strict');
app.setPath('userData', process.env.STRETCH_PET_SMOKE_DATA);
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  contents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
  contents.on('did-fail-load', (_event, code, description) => errors.push(`${code}: ${description}`));
});
const appRoot = process.env.STRETCH_PET_SMOKE_APP;
require(path.join(appRoot, 'dist/main/main.js'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const deadline = Date.now() + 15000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    win.hide();
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    const run = script => win.webContents.executeJavaScript(script);
    const visible = id => run(`!document.getElementById('${id}').classList.contains('hidden')`);
    await delay(200);
    assert.equal(await run(`typeof window.petAPI.getSettings`), 'function');
    assert.equal(await run(`document.getElementById('pet').naturalWidth > 0`), true);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), 50);
    const assets = ['idle', 'walk', 'stretch'].flatMap(group =>
      fs.readdirSync(path.join(appRoot, 'assets', group)).filter(file => file.endsWith('.png'))
        .map(file => `../../assets/${group}/${file}`));
    assert.equal(await run(`Promise.all(${JSON.stringify(assets)}.map(src => new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => reject(new Error(src)); img.src = src;
    }))).then(results => results.every(Boolean))`), true);
    console.log('PASS: startup, preload, all sprites, settings and focus timer');
    const characters = ['miyo', 'miyox', 'deodeumiyo', 'godmiyo'];
    async function chooseCharacter(index) {
      petMenu = null;
      await run(`document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));`);
      await waitFor(() => Boolean(petMenu), 'right-click menu');
      const items = petMenu.items.find(item => item.submenu).submenu.items;
      assert.equal(items.length, 4);
      items[index].click();
      await waitFor(() => run(`document.getElementById('pet').dataset.character === '${characters[index]}' && document.getElementById('pet').complete && document.getElementById('pet').naturalWidth > 0`), 'character loads');
      assert.equal(await run(`window.petAPI.getSettings().then(s => s.character)`), characters[index]);
    }
    for (let i = 0; i < characters.length; i++) {
      await chooseCharacter(i);
      const files = ['idle/1','idle/2','walk/1','walk/2','walk/3','walk/4',
        'stretch/start','stretch/neck_tilt','stretch/shoulder_roll','stretch/torso_twist',
        'stretch/hip_glute','stretch/leg_extension','stretch/spinal_twist','stretch/deep_breath'];
      assert.equal(await run(`Promise.all(${JSON.stringify(files)}.map(file => new Promise((resolve,reject) => {
        const img = new Image(); img.onload = () => resolve(true); img.onerror = reject;
        img.src = '../../assets/characters/${characters[i]}/' + file + '.png';
      }))).then(values => values.every(Boolean))`), true);
    }
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await waitFor(() => run(`document.getElementById('pet')?.dataset.character === 'godmiyo'`), 'saved character restored');
    console.log('PASS: right-click menu, four character asset sets and persisted selection on reload');
    win.webContents.send('force-stretch');
    await waitFor(() => visible('stretch-panel'), 'stretch starts');
    const pose = await run(`document.getElementById('stretch-name').textContent`);
    await chooseCharacter(0);
    assert.equal(await run(`document.getElementById('stretch-name').textContent`), pose);
    assert.equal(await run(`document.getElementById('pet').src.includes('/miyo/stretch/')`), true);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), null);
    await run(`document.getElementById('stretch-skip').click();`);
    console.log('PASS: character changes during stretch preserve pose and timer');
    // Accelerate only new routine intervals, preserving the production control flow.
    await run(`window.originalInterval = window.setInterval; window.setInterval = (fn, ms, ...args) => window.originalInterval(fn, ms === 1000 ? 10 : ms, ...args); undefined;`);
    win.webContents.send('show-settings-panel', 25);
    await delay(50); assert.equal(await visible('settings-panel'), true);
    await delay(8200); assert.equal(await visible('settings-panel'), true);
    await run(`document.getElementById('settings-minutes-input').value = '30'; document.getElementById('settings-confirm').click();`);
    assert.equal(await visible('settings-panel'), false);
    assert.equal(await run(`window.petAPI.getSettings().then(s => s.focusMinutes)`), 30);
    console.log('PASS: settings panel saves through real IPC');
    win.webContents.send('force-stretch');
    await delay(80); assert.equal(await visible('stretch-panel'), true);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), null);
    await run(`document.getElementById('stretch-skip').click();`);
    assert.equal(await visible('stretch-panel'), false);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), 32);
    console.log('PASS: manual stretch, skip, cooldown and countdown');
    win.webContents.send('force-stretch');
    await waitFor(() => run(`document.getElementById('stretch-countdown').textContent === ''`), 'routine completion message');
    assert.equal(await run(`document.getElementById('stretch-countdown').textContent`), '');
    // Skip during the 3-second completion message and immediately start again.
    await run(`document.getElementById('stretch-skip').click();`);
    win.webContents.send('force-stretch');
    await delay(3400);
    assert.equal(await visible('stretch-panel'), true);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), null);
    await waitFor(async () => !await visible('stretch-panel'), 'completion enters cooldown');
    assert.equal(await visible('stretch-panel'), false);
    assert.equal(await run(`window.petAPI.getMinutesUntilNextStretch()`), 32);
    console.log('PASS: all routine steps, completion, restart and stale completion cancellation');
    assert.deepEqual(errors, []);
    console.log('PASS: no renderer/preload/load errors');
    app.exit(0);
  } catch (error) {
    console.error(error); console.error(errors); app.exit(1);
  }
});

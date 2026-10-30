// PageTurner menu-bar app. Runs the unchanged PageTurner server (server/server.js, copied from the repo root)
// inside Electron's main process and adds a macOS menu-bar item, first-run setup and an iPad QR code.
const { app, Tray, Menu, BrowserWindow, ipcMain, shell, clipboard, dialog, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
const IS_MAC = process.platform === 'darwin', IS_WIN = process.platform === 'win32';
const LOOPMIDI_URL = 'https://www.tobias-erichsen.de/software/loopmidi.html';
if (IS_WIN) app.setAppUserModelId('com.pageturner.desktop');

// ---------- settings + log ----------
const userDir = app.getPath('userData');
const SETTINGS = path.join(userDir, 'settings.json');
const LOG_DIR = path.join(userDir, 'logs'); fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG = path.join(LOG_DIR, 'pageturner.log');
try { if (fs.statSync(LOG).size > 5e6) fs.renameSync(LOG, LOG + '.old'); } catch (_) {}
const logStream = fs.createWriteStream(LOG, { flags: 'a' });
for (const k of ['log', 'warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { orig(...a); logStream.write(new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : require('util').inspect(x)).join(' ') + '\n'); };
}
let settings = { setupDone: false, projectsDir: path.join(os.homedir(), 'PageTurnerProjects'), midiPort: '' };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch (_) {}
// test/advanced override: PAGETURNER_PROJECTS env wins (used for testing without touching the real folder)
if (process.env.PAGETURNER_PROJECTS) settings.projectsDir = process.env.PAGETURNER_PROJECTS;
function saveSettings() { fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); }

// ---------- port: prefer 3000, never 80, skip anything busy (e.g. another PageTurner, AbleSet) ----------
function portFree(port) {
    return new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, () => s.close(() => res(true))); });
}
async function pickPort() {
    const pref = Number(process.env.PAGETURNER_PORT) || 3000;
    for (let p = pref; p < pref + 100; p++) { if (p === 80 || p === 443) continue; if (await portFree(p)) return p; }
    throw new Error('No free port between ' + pref + ' and ' + (pref + 99));
}

// ---------- state ----------
let port = null, tray = null, sock = null, status = { midi: {}, addresses: [], project: {} }, lastPcTimer = null;
const base = () => 'http://127.0.0.1:' + port;

async function startServer() {
    port = await pickPort();
    fs.mkdirSync(settings.projectsDir, { recursive: true });
    process.env.PORT = String(port);
    process.env.PAGETURNER_PROJECTS = settings.projectsDir;
    process.argv.splice(2, process.argv.length, settings.midiPort || '');   // same MIDI arg as `node server.js <name>`
    console.log(`[desktop] starting server on port ${port}, projects ${settings.projectsDir}, MIDI "${settings.midiPort || '(auto)'}"`);
    require(path.join(__dirname, 'server', 'server.js'));
    for (let i = 0; i < 50; i++) {   // wait until it answers
        try { const r = await fetch(base() + '/api/status'); if (r.ok) { status = await r.json(); return; } } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('The PageTurner server did not start (see log)');
}

function ipadUrls() {
    const a = (status.addresses || []).slice();
    // USB / Internet-sharing (bridge, 169.254 / 192.168.2.x) first, then Wi-Fi, hostname last
    const rank = x => x.iface === 'hostname' ? 3 : /^bridge/.test(x.iface) ? 0 : /^en0$/.test(x.iface) ? 1 : 2;
    return a.sort((x, y) => rank(x) - rank(y));
}
async function refreshStatus() {
    try { status = await (await fetch(base() + '/api/status')).json(); } catch (_) {}
    buildMenu();
}

function connectSocket() {
    const { io } = require('socket.io-client');
    sock = io(base(), { transports: ['websocket'] });
    sock.on('midi_status', m => { status.midi = m; buildMenu(); });
    sock.on('project_state', p => { status.project = p; buildMenu(); });
    sock.on('midi_pc', p => {
        status.midi.lastPc = p; buildMenu();
        if (IS_MAC) { tray.setTitle(' Pgm ' + p.pc); clearTimeout(lastPcTimer); lastPcTimer = setTimeout(() => tray.setTitle(''), 4000); }
        else tray.setToolTip('PageTurner – last Pgm ' + p.pc);
    });
}

function setMidi(name) {
    settings.midiPort = name; saveSettings();
    sock && sock.emit('set_midi_port', name);
}

// ---------- menu bar ----------
function buildMenu() {
    if (!tray) return;
    const m = status.midi || {}, urls = ipadUrls(), proj = status.project || {};
    const t = [];
    t.push({ label: `PageTurner is running (port ${port})`, enabled: false });
    if (port !== 3000) t.push({ label: '  Port 3000 was busy, so PageTurner uses ' + port, enabled: false });
    t.push({ type: 'separator' });
    t.push({ label: 'Open on iPad (click to copy):', enabled: false });
    if (!urls.filter(u => u.iface !== 'hostname').length) t.push({ label: '  ⚠️ No network – connect the iPad by Wi-Fi or USB + Internet Sharing', enabled: false });
    urls.forEach(u => t.push({ label: '  ' + u.url + (u.iface === 'hostname' ? '' : '   (' + u.iface + ')'), click: () => clipboard.writeText(u.url) }));
    t.push({ label: 'Show iPad QR code…', click: showQr });
    t.push({ type: 'separator' });
    const ports = m.availablePorts || [];
    t.push({ label: m.connectedPort ? 'MIDI input: ' + m.connectedPort : (m.wantedPort ? '⚠️ MIDI input "' + m.wantedPort + '" is gone – waiting' : '⚠️ No MIDI input'),
        submenu: [...(ports.length ? ports.map(p => ({ label: p, type: 'radio', checked: p === m.connectedPort, click: () => setMidi(p) }))
                                   : [{ label: 'No MIDI inputs found', enabled: false }]),
                  { type: 'separator' }, IS_MAC ? { label: 'Open Audio MIDI Setup (enable IAC Driver)…', click: openAudioMidiSetup }
                                                : { label: 'Get loopMIDI (virtual MIDI port for Windows)…', click: () => shell.openExternal(LOOPMIDI_URL) }] });
    const lp = m.lastPc; t.push({ label: lp ? `Last Program Change: Pgm ${lp.pc}  (${new Date(lp.at).toLocaleTimeString()})` : 'Last Program Change: none yet', enabled: false });
    t.push({ label: proj.active ? 'Active project: ' + proj.name : 'No active project (PC N → page N)', enabled: false });
    t.push({ type: 'separator' });
    t.push({ label: 'Open Composer', click: () => shell.openExternal('http://localhost:' + port + '/composer/') });
    t.push({ label: IS_MAC ? 'Open Viewer on this Mac' : 'Open Viewer on this PC', click: () => shell.openExternal('http://localhost:' + port + '/') });
    t.push({ label: 'Open Projects Folder', click: () => shell.openPath(settings.projectsDir) });
    t.push({ label: 'Show Log', click: () => shell.openPath(LOG) });
    t.push({ type: 'separator' });
    t.push({ label: 'Setup…', click: showSetup });
    t.push({ label: 'Launch at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) });
    t.push({ type: 'separator' });
    t.push(IS_MAC ? { label: 'Quit PageTurner', accelerator: 'Command+Q', click: () => app.quit() } : { label: 'Quit PageTurner', click: () => app.quit() });
    tray.setContextMenu(Menu.buildFromTemplate(t));
    tray.setToolTip('PageTurner – ' + (urls[0] ? urls[0].url : 'port ' + port));
}

function openAudioMidiSetup() {
    if (!IS_MAC) return shell.openExternal(LOOPMIDI_URL);
    const p = '/System/Applications/Utilities/Audio MIDI Setup.app';
    shell.openPath(fs.existsSync(p) ? p : '/Applications/Utilities/Audio MIDI Setup.app');
}

// ---------- windows ----------
let qrWin = null, setupWin = null;
function win(file, w, h, title) {
    const bw = new BrowserWindow({ width: w, height: h, title, resizable: true, show: false, webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js') } });
    bw.loadFile(path.join(__dirname, 'ui', file)); bw.once('ready-to-show', () => { bw.show(); app.focus({ steal: true }); });
    return bw;
}
function showQr() { if (qrWin && !qrWin.isDestroyed()) return qrWin.focus(); qrWin = win('qr.html', 460, 600, 'Open PageTurner on your iPad'); }
function showSetup() { if (setupWin && !setupWin.isDestroyed()) return setupWin.focus(); setupWin = win('setup.html', 720, 760, 'PageTurner Setup'); }

ipcMain.handle('info', async () => {
    await refreshStatus();
    const QR = require('qrcode');
    const urls = ipadUrls();
    for (const u of urls) u.qr = await QR.toDataURL(u.url, { margin: 1, width: 300 });
    return { port, platform: process.platform, urls, midi: status.midi, settings, sampleAvailable: fs.existsSync(sampleSrc()), projectsDirDefault: path.join(os.homedir(), 'PageTurnerProjects') };
});
ipcMain.handle('choose-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: settings.projectsDir });
    return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-audio-midi-setup', () => openAudioMidiSetup());
ipcMain.handle('set-midi', (e, n) => setMidi(n));
ipcMain.handle('open-url', (e, u) => shell.openExternal(u));
function sampleSrc() { return app.isPackaged ? path.join(process.resourcesPath, 'Sample Project.pdset') : path.join(__dirname, 'build-resources', 'Sample Project.pdset'); }
ipcMain.handle('finish-setup', async (e, { projectsDir, addSample }) => {
    const changed = projectsDir && projectsDir !== settings.projectsDir;
    if (projectsDir) settings.projectsDir = projectsDir;
    fs.mkdirSync(settings.projectsDir, { recursive: true });
    let sample = null;
    if (addSample) {
        const dst = path.join(settings.projectsDir, 'Sample Project.pdset');
        if (!fs.existsSync(dst)) { fs.copyFileSync(sampleSrc(), dst); sample = 'added'; } else sample = 'exists';
    }
    settings.setupDone = true; saveSettings();
    if (changed && !process.env.PAGETURNER_PROJECTS) { app.relaunch(); app.exit(0); }   // the server reads the folder at start
    return { sample };
});

// ---------- lifecycle ----------
app.on('second-instance', () => showSetup());
app.on('window-all-closed', e => { /* keep running in the menu bar */ });
app.whenReady().then(async () => {
    if (process.env.PAGETURNER_SMOKE) {   // CI: start the bundled server without UI, print status, quit
        try { await startServer(); console.log('SMOKE_STATUS ' + JSON.stringify(status)); app.exit(0); }
        catch (e) { console.error('SMOKE_FAIL', e); app.exit(1); }
        return;
    }
    if (app.dock) app.dock.hide();
    let icon;
    if (IS_MAC) { icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png')); icon.setTemplateImage(true); }
    else icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-win.png'));   // colour icon for the Windows notification area
    tray = new Tray(icon);
    if (!IS_MAC) tray.on('click', () => tray.popUpContextMenu());   // Windows: left-click opens the menu too
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Starting PageTurner…', enabled: false }, { label: 'Quit', click: () => app.quit() }]));
    try { await startServer(); }
    catch (err) {
        console.error('[desktop] start failed', err);
        dialog.showErrorBox('PageTurner could not start', String(err && err.message || err) + '\n\nLog: ' + LOG);
        app.exit(1); return;
    }
    connectSocket(); buildMenu();
    setInterval(refreshStatus, 10000);   // network addresses change when USB / Wi-Fi come and go
    if (!settings.setupDone) showSetup();
    console.log('[desktop] ready on ' + base());
    if (process.env.PAGETURNER_SNAPSHOT) snapshot(process.env.PAGETURNER_SNAPSHOT);   // dev/test only: screenshots
});
app.on('before-quit', () => { console.log('[desktop] quitting – server stops with the app'); });

// dev/test helper (only when PAGETURNER_SNAPSHOT=<dir> is set): save the setup + QR windows as PNG and pop the menu open briefly
async function snapshot(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    showSetup(); await sleep(3500);
    fs.writeFileSync(path.join(dir, 'setup.png'), (await setupWin.webContents.capturePage()).toPNG());
    showQr(); await sleep(2500);
    fs.writeFileSync(path.join(dir, 'qr.png'), (await qrWin.webContents.capturePage()).toPNG());
    qrWin.close(); setupWin.close();
    fs.writeFileSync(path.join(dir, 'menu-open'), String(Date.now()));
    setTimeout(() => { try { tray.closeContextMenu && tray.closeContextMenu(); } catch (_) {} fs.writeFileSync(path.join(dir, 'menu-closed'), String(Date.now())); }, 6000);
    tray.popUpContextMenu();
}

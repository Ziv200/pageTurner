// Composer v2: program-change table (song + page per MIDI Program Change).
// PDFs stay in their own folder on the Mac; projects are ~/PageTurnerProjects/<name>.pdset (JSON, version 2).
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ROOT = process.env.PAGETURNER_PROJECTS || path.join(os.homedir(), 'PageTurnerProjects');
const ACTIVE_FILE = path.join(ROOT, '.active.json');

// ---------- validation helpers ----------
function safeProjectName(n) {
    if (typeof n !== 'string') return null;
    const s = n.trim();
    if (!s || s.length > 120 || s.startsWith('.')) return null;
    if (!/^[\p{L}\p{N} ._()\-]+$/u.test(s)) return null;
    return s;
}

// A song is a bare file name inside the project folder: no separators, must end in .pdf
function safeSongName(n) {
    if (typeof n !== 'string' || !n || n.length > 255) return null;
    if (n.includes('/') || n.includes('\\') || n.includes('\0') || n.startsWith('.')) return null;
    if (n !== path.basename(n) || !/\.pdf$/i.test(n)) return null;
    return n;
}

async function resolveFolder(p) {
    if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) throw httpError(400, 'Please enter a full folder path starting with /');
    let real;
    try { real = await fs.promises.realpath(p); } catch (_) { throw httpError(404, 'Folder not found'); }
    const st = await fs.promises.stat(real);
    if (!st.isDirectory()) throw httpError(400, 'That path is not a folder');
    return real;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function isRealPdf(file) {
    let fh;
    try {
        fh = await fs.promises.open(file, 'r');
        const b = Buffer.alloc(1024);
        const { bytesRead } = await fh.read(b, 0, 1024, 0);
        return b.slice(0, bytesRead).includes('%PDF-');
    } catch (_) { return false; } finally { if (fh) await fh.close().catch(() => {}); }
}

const pageCache = new Map(); // key path|size|mtime -> {pages}|{error}
async function pageCount(file, st) {
    const key = file + '|' + st.size + '|' + st.mtimeMs;
    if (pageCache.has(key)) return pageCache.get(key);
    let res;
    try {
        const buf = await fs.promises.readFile(file);
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
        res = { pages: doc.getPageCount() };
    } catch (e) { res = { error: 'Damaged or unreadable PDF' }; }
    pageCache.set(key, res);
    return res;
}

async function listPdfs(folderReal) {
    const entries = await fs.promises.readdir(folderReal, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
        if (e.name.startsWith('.') || !safeSongName(e.name)) continue;
        const f = path.join(folderReal, e.name);
        let st;
        try { st = await fs.promises.stat(f); } catch (_) { continue; } // broken symlink etc.
        if (!st.isFile()) continue;
        try { if (path.dirname(await fs.promises.realpath(f)) !== folderReal) continue; } catch (_) { continue; } // symlink leaving the folder
        if (!(await isRealPdf(f))) continue;
        const pc = await pageCount(f, st);
        out.push({ name: e.name, size: st.size, modified: st.mtimeMs, pages: pc.pages || 0, error: pc.error || null });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return out;
}

// Validate a version-2 project object. Returns a clean copy or throws httpError(400).
function cleanProject(p, nameFallback) {
    if (!p || typeof p !== 'object') throw httpError(400, 'Invalid project data');
    if (p.version !== 2) throw httpError(400, 'Unsupported .pdset version (expected 2)');
    if (typeof p.folder !== 'string' || !path.isAbsolute(p.folder) || p.folder.includes('\0')) throw httpError(400, 'Project has no valid folder path');
    if (!Array.isArray(p.rows) || p.rows.length > 1000) throw httpError(400, 'Project rows are invalid');
    const rows = p.rows.map((r, i) => {
        const pc = r && r.pc, page = r && r.page;
        const song = r && r.song;
        if (!Number.isInteger(pc) || pc < 0 || pc > 127) throw httpError(400, 'Row ' + (i + 1) + ': Program Change must be a whole number 0-127');
        if (!Number.isInteger(page) || page < 1 || page > 100000) throw httpError(400, 'Row ' + (i + 1) + ': page must be a whole number, 1 or more');
        if (!safeSongName(song)) throw httpError(400, 'Row ' + (i + 1) + ': invalid song file name');
        return { pc, song, page };
    });
    const seen = new Set();
    for (const r of rows) { if (seen.has(r.pc)) throw httpError(400, 'Duplicate Program Change number ' + r.pc); seen.add(r.pc); }
    return { version: 2, name: typeof p.name === 'string' ? p.name : (nameFallback || 'Untitled'), folder: p.folder, rows };
}

module.exports = function createComposer(io) {
    // ---------- active project state ----------
    let active = null;       // { name, folder (real), rows, byPc:Map, songs:Set, rev }
    let current = null;      // { seq, pc, song, page }
    let seq = 0;

    function publicState() {
        if (!active) return { active: false };
        return {
            active: true, name: active.name, rev: active.rev,
            songs: Array.from(active.songs),
            current
        };
    }

    async function setActive(project) {
        const folder = await resolveFolder(project.folder);
        const rows = project.rows;
        active = {
            name: project.name, folder, rows,
            byPc: new Map(rows.map(r => [r.pc, r])),
            songs: new Set(rows.map(r => r.song)),
            rev: Date.now()
        };
        current = null;
        io.emit('project_state', publicState());
        console.log(`\n📖 Active project: "${active.name}" (${rows.length} rows) in ${folder}`);
    }

    function clearActive() {
        active = null; current = null;
        io.emit('project_state', publicState());
        console.log('\n📖 Active project cleared - viewer uses direct Program Change -> page jump');
    }

    // Single code path for real MIDI and the test button.
    function handleProgramChange(pc, source) {
        if (!active) {
            console.log(`🎛️ PC ${pc} (${source}) -> no active project, jump to page ${pc + 1}`);
            io.emit('page_change', { page: pc + 1 });
            return { mode: 'direct', page: pc + 1 };
        }
        const row = active.byPc.get(pc);
        if (!row) {
            console.log(`🎛️ PC ${pc} (${source}) -> not in project "${active.name}"`);
            io.emit('pc_unknown', { pc });
            return { mode: 'project', found: false, pc };
        }
        current = { seq: ++seq, pc: row.pc, song: row.song, page: row.page };
        console.log(`🎛️ PC ${pc} (${source}) -> "${row.song}" page ${row.page}`);
        io.emit('song_select', current);
        return { mode: 'project', found: true, ...current };
    }

    // restore last active project after restart
    (async () => {
        try {
            const j = JSON.parse(await fs.promises.readFile(ACTIVE_FILE, 'utf8'));
            const n = safeProjectName(j.name);
            if (!n) return;
            const p = cleanProject(JSON.parse(await fs.promises.readFile(path.join(ROOT, n + '.pdset'), 'utf8')), n);
            await setActive(p);
        } catch (_) { /* nothing to restore */ }
    })();

    // ---------- router ----------
    const router = express.Router();

    // Viewer-facing (open to the iPad)
    router.get('/active', (req, res) => res.json(publicState()));

    router.get('/active/pdf/:name', async (req, res) => {
        const name = safeSongName(req.params.name);
        if (!active || !name || !active.songs.has(name)) return res.status(404).json({ error: 'Not part of the active project' });
        try {
            const file = await fs.promises.realpath(path.join(active.folder, name));
            if (path.dirname(file) !== active.folder) return res.status(403).json({ error: 'Forbidden' });
            res.set('Cache-Control', 'no-cache');
            res.type('application/pdf');
            res.sendFile(file, { dotfiles: 'deny' }, err => { if (err && !res.headersSent) res.status(404).json({ error: 'File missing' }); });
        } catch (_) { res.status(404).json({ error: 'File missing' }); }
    });

    // Everything below is for the Mac that runs the server (it can read/write local files).
    function isLocal(req) {
        if (process.env.COMPOSER_REMOTE === '1') return true;
        const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, '').replace(/%.*$/, '');
        if (a === '127.0.0.1' || a === '::1') return true;
        const ifs = os.networkInterfaces();
        return Object.keys(ifs).some(k => ifs[k].some(i => i.address.replace(/%.*$/, '') === a));
    }
    router.use((req, res, next) => isLocal(req) ? next() : res.status(403).json({ error: 'Composer can only be used from the Mac running PageTurner' }));

    const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(err.status || 500).json({ error: err.message }));

    router.get('/browse', wrap(async (req, res) => {
        const real = await resolveFolder(req.query.path || os.homedir());
        const entries = await fs.promises.readdir(real, { withFileTypes: true });
        const dirs = [];
        let pdfs = 0;
        for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            let isDir = e.isDirectory();
            if (e.isSymbolicLink()) { try { isDir = (await fs.promises.stat(path.join(real, e.name))).isDirectory(); } catch (_) {} }
            if (isDir) dirs.push(e.name);
            else if (/\.pdf$/i.test(e.name)) pdfs++;
        }
        dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const parent = path.dirname(real);
        res.json({ path: real, parent: parent === real ? null : parent, home: os.homedir(), dirs, pdfCount: pdfs });
    }));

    router.get('/folder', wrap(async (req, res) => {
        const real = await resolveFolder(req.query.path);
        res.json({ path: real, files: await listPdfs(real) });
    }));

    router.get('/pdf', wrap(async (req, res) => {
        const real = await resolveFolder(req.query.folder);
        const name = safeSongName(req.query.name);
        if (!name) throw httpError(400, 'Invalid file name');
        const file = await fs.promises.realpath(path.join(real, name)).catch(() => { throw httpError(404, 'File missing'); });
        if (path.dirname(file) !== real) throw httpError(403, 'Forbidden');
        if (!(await isRealPdf(file))) throw httpError(400, 'Not a PDF');
        res.set('Cache-Control', 'no-cache');
        res.type('application/pdf');
        res.sendFile(file, { dotfiles: 'deny' });
    }));

    router.get('/projects', wrap(async (req, res) => {
        await fs.promises.mkdir(ROOT, { recursive: true });
        const out = [];
        for (const e of await fs.promises.readdir(ROOT, { withFileTypes: true })) {
            if (!e.isFile() || e.name.startsWith('.') || !e.name.endsWith('.pdset')) continue;
            const st = await fs.promises.stat(path.join(ROOT, e.name));
            out.push({ name: e.name.slice(0, -6), modified: st.mtimeMs });
        }
        out.sort((a, b) => b.modified - a.modified);
        res.json({ root: ROOT, projects: out, active: active ? active.name : null });
    }));

    router.get('/projects/:name', wrap(async (req, res) => {
        const n = safeProjectName(req.params.name);
        if (!n) throw httpError(400, 'Invalid project name');
        let txt;
        try { txt = await fs.promises.readFile(path.join(ROOT, n + '.pdset'), 'utf8'); } catch (_) { throw httpError(404, 'Project not found'); }
        let data;
        try { data = JSON.parse(txt); } catch (_) { throw httpError(400, 'Project file is damaged'); }
        res.json(data);
    }));

    router.put('/projects/:name', express.json({ limit: '2mb' }), wrap(async (req, res) => {
        const n = safeProjectName(req.params.name);
        if (!n) throw httpError(400, 'Invalid project name');
        const p = cleanProject(req.body, n);
        p.name = n;
        await fs.promises.mkdir(ROOT, { recursive: true });
        const file = path.join(ROOT, n + '.pdset');
        await fs.promises.writeFile(file + '.tmp', JSON.stringify(p, null, 2));
        await fs.promises.rename(file + '.tmp', file); // atomic
        // saving the active project updates what the viewer uses
        if (active && active.name === n) await setActive(p).catch(() => {});
        res.json({ ok: true, file });
    }));

    router.post('/active', express.json({ limit: '10kb' }), wrap(async (req, res) => {
        const body = req.body || {};
        if (body.name === null) {
            clearActive();
            await fs.promises.rm(ACTIVE_FILE, { force: true });
            return res.json({ ok: true, active: false });
        }
        const n = safeProjectName(body.name);
        if (!n) throw httpError(400, 'Invalid project name');
        let p;
        try { p = cleanProject(JSON.parse(await fs.promises.readFile(path.join(ROOT, n + '.pdset'), 'utf8')), n); }
        catch (e) { throw e.status ? e : httpError(404, 'Project not found - save it first'); }
        await setActive(p);
        await fs.promises.mkdir(ROOT, { recursive: true });
        await fs.promises.writeFile(ACTIVE_FILE, JSON.stringify({ name: n }));
        res.json({ ok: true, active: true, name: n });
    }));

    // Simulates a MIDI Program Change through the exact same handler as real MIDI.
    router.post('/test-pc', express.json({ limit: '1kb' }), wrap(async (req, res) => {
        const pc = req.body && req.body.pc;
        if (!Number.isInteger(pc) || pc < 0 || pc > 127) throw httpError(400, 'pc must be a whole number 0-127');
        res.json(handleProgramChange(pc, 'test'));
    }));

    return { router, handleProgramChange, publicState };
};
module.exports.safeSongName = safeSongName;

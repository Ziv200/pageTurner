// Composer v3: program-change table (song + page per MIDI Program Change).
// A project is ONE self-contained file, ~/PageTurnerProjects/<name>.pdset, with the PDFs embedded.
//
// .pdset container (version 3):
//   bytes 0-7   magic "PDSET3\0\0"
//   bytes 8-11  header length N (uint32, big endian)
//   bytes 12..  header: UTF-8 JSON { version:3, name, rows:[{pc,song,page}], pdfs:[{name,size,pages,error?}] }
//   then        the raw PDF bytes, one after another, in the order (and with the sizes) listed in header.pdfs
// No offsets are stored (they are derived from the sizes), so a header can't point outside the file.
// PDFs are never re-encoded: the browser builds the file from Blob parts and the server streams it to disk.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const ROOT = process.env.PAGETURNER_PROJECTS || path.join(os.homedir(), 'PageTurnerProjects');
const ACTIVE_FILE = path.join(ROOT, '.active.json');
const MAGIC = Buffer.from('PDSET3\0\0', 'latin1');
const MAX_HEADER = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES = Number(process.env.COMPOSER_MAX_BYTES) || 2 * 1024 * 1024 * 1024;
const MAX_PDFS = 500;

// ---------- validation helpers ----------
function safeProjectName(n) {
    if (typeof n !== 'string') return null;
    const s = n.trim();
    if (!s || s.length > 120 || s.startsWith('.')) return null;
    if (!/^[\p{L}\p{N} ._()\-]+$/u.test(s)) return null;
    return s;
}

// A song is a bare file name: no separators, must end in .pdf
function safeSongName(n) {
    if (typeof n !== 'string' || !n || n.length > 255) return null;
    if (n.includes('/') || n.includes('\\') || n.includes('\0') || n.startsWith('.')) return null;
    if (n !== path.basename(n) || !/\.pdf$/i.test(n)) return null;
    if (/[\u0000-\u001f]/.test(n)) return null;
    return n;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Reads and validates the container header. Returns { header, dataStart, offsets:Map(name->{start,size}), fileSize }.
async function readContainer(file) {
    let fh;
    try { fh = await fs.promises.open(file, 'r'); } catch (_) { throw httpError(404, 'Project not found'); }
    try {
        const st = await fh.stat();
        const top = Buffer.alloc(12);
        const { bytesRead } = await fh.read(top, 0, 12, 0);
        if (bytesRead < 12 || !top.subarray(0, 8).equals(MAGIC)) {
            // old versions were plain JSON
            const b = Buffer.alloc(Math.min(st.size, 2048)); await fh.read(b, 0, b.length, 0);
            if (b.toString('utf8').trimStart().startsWith('{')) throw httpError(400, 'This is an older (version 2) project that depends on a folder. It cannot be opened - please re-create it by loading the PDFs into Composer and saving again.');
            throw httpError(400, 'Not a PageTurner .pdset file');
        }
        const hlen = top.readUInt32BE(8);
        if (hlen < 2 || hlen > MAX_HEADER || 12 + hlen > st.size) throw httpError(400, 'Project file is damaged (bad header)');
        const hb = Buffer.alloc(hlen); await fh.read(hb, 0, hlen, 12);
        let header;
        try { header = JSON.parse(hb.toString('utf8')); } catch (_) { throw httpError(400, 'Project file is damaged (unreadable header)'); }
        header = cleanHeader(header);
        const dataStart = 12 + hlen;
        let off = dataStart; const offsets = new Map();
        for (const p of header.pdfs) { offsets.set(p.name, { start: off, size: p.size }); off += p.size; }
        if (off !== st.size) throw httpError(400, 'Project file is damaged (size mismatch - incomplete copy?)');
        const probe = Buffer.alloc(1024);
        for (const p of header.pdfs) {
            if (!p.size) throw httpError(400, 'Project file is damaged (empty PDF)');
            const o = offsets.get(p.name);
            const r = await fh.read(probe, 0, Math.min(1024, p.size), o.start);
            if (!probe.subarray(0, r.bytesRead).includes('%PDF-')) throw httpError(400, 'Project file is damaged (' + p.name + ' is not a PDF)');
        }
        return { header, dataStart, offsets, fileSize: st.size, mtimeMs: st.mtimeMs };
    } finally { await fh.close().catch(() => {}); }
}

function cleanHeader(h) {
    if (!h || typeof h !== 'object') throw httpError(400, 'Invalid project data');
    if (h.version !== 3) throw httpError(400, 'Unsupported .pdset version (expected 3)');
    if (!Array.isArray(h.pdfs) || h.pdfs.length > MAX_PDFS) throw httpError(400, 'Project PDF list is invalid');
    const names = new Set(); const lower = new Set();
    const pdfs = h.pdfs.map((p, i) => {
        const name = p && p.name;
        if (!safeSongName(name)) throw httpError(400, 'PDF ' + (i + 1) + ': invalid file name');
        if (lower.has(name.toLowerCase())) throw httpError(400, 'Duplicate PDF name ' + name);
        lower.add(name.toLowerCase()); names.add(name);
        if (!Number.isSafeInteger(p.size) || p.size < 0) throw httpError(400, 'PDF ' + name + ': invalid size');
        const pages = Number.isInteger(p.pages) && p.pages >= 0 && p.pages < 1e6 ? p.pages : 0;
        const out = { name, size: p.size, pages };
        if (p.error) out.error = true;
        return out;
    });
    if (!Array.isArray(h.rows) || h.rows.length > 1000) throw httpError(400, 'Project rows are invalid');
    const rows = h.rows.map((r, i) => {
        const pc = r && r.pc, page = r && r.page, song = r && r.song;
        if (!Number.isInteger(pc) || pc < 1 || pc > 128) throw httpError(400, 'Row ' + (i + 1) + ': Program Change must be a whole number 1-128');
        if (!Number.isInteger(page) || page < 1 || page > 100000) throw httpError(400, 'Row ' + (i + 1) + ': page must be a whole number, 1 or more');
        if (!safeSongName(song)) throw httpError(400, 'Row ' + (i + 1) + ': invalid song file name');
        if (!names.has(song)) throw httpError(400, 'Row ' + (i + 1) + ': song "' + song + '" is not stored in the project');
        return { pc, song, page };
    });
    const seen = new Set();
    for (const r of rows) { if (seen.has(r.pc)) throw httpError(400, 'Duplicate Program Change number ' + r.pc); seen.add(r.pc); }
    return { version: 3, name: typeof h.name === 'string' ? h.name.slice(0, 120) : 'Untitled', rows, pdfs };
}

function streamRange(res, file, start, size, next) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(size), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (size === 0) return res.end();
    const rs = fs.createReadStream(file, { start, end: start + size - 1 });
    rs.on('error', () => { if (!res.headersSent) next(httpError(404, 'File missing')); else res.destroy(); });
    rs.pipe(res);
}

module.exports = function createComposer(io) {
    // ---------- active project state ----------
    let active = null;       // { name, file, header, rows, byPc:Map, songs:Set, offsets, fileSize, mtimeMs, rev }
    let current = null;      // { seq, pc, song, page }
    let seq = 0;

    function publicState() {
        if (!active) return { active: false };
        const pcs = {};   // song -> Ableton-style Pgm numbers that open it (ascending)
        active.rows.forEach(r => { (pcs[r.song] = pcs[r.song] || []).push(r.pc); });
        Object.keys(pcs).forEach(k => pcs[k].sort((a, b) => a - b));
        return { active: true, name: active.name, rev: active.rev, songs: Array.from(active.songs), pcs, current };
    }

    async function setActive(name) {
        const file = path.join(ROOT, name + '.pdset');
        const c = await readContainer(file);
        active = {
            name, file, header: c.header, rows: c.header.rows,
            byPc: new Map(c.header.rows.map(r => [r.pc, r])),
            songs: new Set(c.header.rows.map(r => r.song)),
            offsets: c.offsets, fileSize: c.fileSize, mtimeMs: c.mtimeMs,
            rev: Date.now()
        };
        current = null;
        io.emit('project_state', publicState());
        console.log(`\n📖 Active project: "${name}" (${active.rows.length} rows, ${c.header.pdfs.length} PDFs embedded)`);
    }

    function clearActive() {
        active = null; current = null;
        io.emit('project_state', publicState());
        console.log('\n📖 Active project cleared - viewer uses direct Program Change -> page jump');
    }

    // Single code path for real MIDI and the test button.
    // `raw` is the raw MIDI Program Change value (0-127). Ableton displays it as raw+1 (1-128),
    // and the project table uses the Ableton-style number. The ONLY raw->table mapping is here.
    function handleProgramChange(raw, source) {
        const pc = raw + 1;   // Ableton-style number "Pgm N"
        if (!active) {
            console.log(`🎛️ Pgm ${pc} (raw ${raw}, ${source}) -> no active project, jump to page ${pc}`);
            io.emit('page_change', { page: pc });
            return { mode: 'direct', page: pc };
        }
        const row = active.byPc.get(pc);
        if (!row) {
            console.log(`🎛️ Pgm ${pc} (raw ${raw}, ${source}) -> not in project "${active.name}"`);
            io.emit('pc_unknown', { pc });
            return { mode: 'project', found: false, pc };
        }
        current = { seq: ++seq, pc: row.pc, song: row.song, page: row.page };
        console.log(`🎛️ Pgm ${pc} (raw ${raw}, ${source}) -> "${row.song}" page ${row.page}`);
        io.emit('song_select', current);
        return { mode: 'project', found: true, ...current };
    }

    // restore last active project after restart
    (async () => {
        try {
            const j = JSON.parse(await fs.promises.readFile(ACTIVE_FILE, 'utf8'));
            const n = safeProjectName(j.name);
            if (n) await setActive(n);
        } catch (_) { /* nothing to restore */ }
    })();

    // ---------- router ----------
    const router = express.Router();

    // Viewer-facing (open to the iPad): only PDFs that belong to the active project
    router.get('/active', (req, res) => res.json(publicState()));

    router.get('/active/pdf/:name', async (req, res, next) => {
        const name = safeSongName(req.params.name);
        if (!active || !name || !active.songs.has(name)) return res.status(404).json({ error: 'Not part of the active project' });
        try {
            let st;
            try { st = await fs.promises.stat(active.file); } catch (_) { return res.status(404).json({ error: 'Project file missing' }); }
            if (st.size !== active.fileSize || st.mtimeMs !== active.mtimeMs) { // file was replaced on disk: re-read it
                const c = await readContainer(active.file);
                active.header = c.header; active.offsets = c.offsets; active.fileSize = c.fileSize; active.mtimeMs = c.mtimeMs;
            }
            const o = active.offsets.get(name);
            if (!o) return res.status(404).json({ error: 'Not part of the active project' });
            streamRange(res, active.file, o.start, o.size, next);
        } catch (_) { if (!res.headersSent) res.status(404).json({ error: 'File missing' }); }
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

    const wrap = fn => (req, res, next) => fn(req, res, next).catch(err => { if (res.headersSent) return res.destroy(); res.status(err.status || 500).json({ error: err.message }); });
    const projectFile = n => path.join(ROOT, n + '.pdset');

    router.get('/projects', wrap(async (req, res) => {
        await fs.promises.mkdir(ROOT, { recursive: true });
        const out = [];
        for (const e of await fs.promises.readdir(ROOT, { withFileTypes: true })) {
            if (!e.isFile() || e.name.startsWith('.') || !e.name.endsWith('.pdset')) continue;
            const st = await fs.promises.stat(path.join(ROOT, e.name));
            out.push({ name: e.name.slice(0, -6), modified: st.mtimeMs, size: st.size });
        }
        out.sort((a, b) => b.modified - a.modified);
        res.json({ root: ROOT, projects: out, active: active ? active.name : null });
    }));

    // header only (rows + PDF list); the PDFs are fetched one by one
    router.get('/projects/:name', wrap(async (req, res) => {
        const n = safeProjectName(req.params.name);
        if (!n) throw httpError(400, 'Invalid project name');
        const c = await readContainer(projectFile(n));
        res.json({ ...c.header, totalBytes: c.fileSize });
    }));

    router.get('/projects/:name/pdf/:i', wrap(async (req, res, next) => {
        const n = safeProjectName(req.params.name);
        if (!n) throw httpError(400, 'Invalid project name');
        const i = /^\d{1,4}$/.test(req.params.i) ? parseInt(req.params.i, 10) : -1;
        const c = await readContainer(projectFile(n));
        if (i < 0 || i >= c.header.pdfs.length) throw httpError(404, 'No such PDF in the project');
        const o = c.offsets.get(c.header.pdfs[i].name);
        streamRange(res, projectFile(n), o.start, o.size, next);
    }));

    // Raw upload of the complete container. Streamed to a temp file, validated, then renamed into place.
    router.put('/projects/:name', wrap(async (req, res) => {
        const n = safeProjectName(req.params.name);
        if (!n) throw httpError(400, 'Invalid project name');
        const len = Number(req.headers['content-length']);
        if (!Number.isFinite(len) || len < 12) throw httpError(411, 'Content-Length required');
        if (len > MAX_PROJECT_BYTES) throw httpError(413, 'Project is too large (limit ' + Math.round(MAX_PROJECT_BYTES / 1048576) + ' MB)');
        await fs.promises.mkdir(ROOT, { recursive: true });
        const file = projectFile(n);
        const tmp = file + '.' + process.pid + '.tmp';
        let received = 0;
        req.on('data', c => { received += c.length; if (received > len) req.destroy(new Error('Body longer than declared')); });
        try {
            await pipeline(req, fs.createWriteStream(tmp));
            if (received !== len) throw httpError(400, 'Upload incomplete');
            const c = await readContainer(tmp);
            if (c.header.name !== n) { /* name in header follows the file name */ }
            await fs.promises.rename(tmp, file); // atomic
            if (active && active.name === n) await setActive(n).catch(() => {});
            res.json({ ok: true, file, size: c.fileSize, pdfs: c.header.pdfs.length });
        } catch (e) {
            await fs.promises.rm(tmp, { force: true });
            throw e.status ? e : httpError(400, 'Upload failed: ' + e.message);
        }
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
        await setActive(n);
        await fs.promises.mkdir(ROOT, { recursive: true });
        await fs.promises.writeFile(ACTIVE_FILE, JSON.stringify({ name: n }));
        res.json({ ok: true, active: true, name: n });
    }));

    // Simulates a MIDI Program Change through the exact same handler as real MIDI.
    router.post('/test-pc', express.json({ limit: '1kb' }), wrap(async (req, res) => {
        const pc = req.body && req.body.pc;
        if (!Number.isInteger(pc) || pc < 1 || pc > 128) throw httpError(400, 'pc must be a whole number 1-128');
        res.json(handleProgramChange(pc - 1, 'test'));   // table number as shown -> simulate raw MIDI = n-1
    }));

    return { router, handleProgramChange, publicState };
};
module.exports.safeSongName = safeSongName;

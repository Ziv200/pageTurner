// Composer: stores projects (.pdset + PDF copies) in ~/PageTurnerProjects/<name>/
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.PAGETURNER_PROJECTS || path.join(os.homedir(), 'PageTurnerProjects');

// Allow letters (any language), digits, space, dot, dash, underscore, parentheses
function safeName(n) {
    if (typeof n !== 'string') return null;
    const s = n.trim();
    if (!s || s.length > 120 || s.startsWith('.')) return null;
    if (!/^[\p{L}\p{N} ._()\-]+$/u.test(s)) return null;
    return s;
}

function projectDir(name) {
    const s = safeName(name);
    return s ? path.join(ROOT, s) : null;
}

module.exports = function composerApi() {
    const r = express.Router();

    r.get('/projects', async (req, res) => {
        try {
            await fs.promises.mkdir(ROOT, { recursive: true });
            const entries = await fs.promises.readdir(ROOT, { withFileTypes: true });
            const out = [];
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('.')) continue;
                const f = path.join(ROOT, e.name, 'project.pdset');
                try {
                    const st = await fs.promises.stat(f);
                    out.push({ name: e.name, modified: st.mtimeMs });
                } catch (_) { /* not a project */ }
            }
            out.sort((a, b) => b.modified - a.modified);
            res.json({ root: ROOT, projects: out });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    r.get('/projects/:name', async (req, res) => {
        const d = projectDir(req.params.name);
        if (!d) return res.status(400).json({ error: 'Invalid project name' });
        try {
            const txt = await fs.promises.readFile(path.join(d, 'project.pdset'), 'utf8');
            res.type('application/json').send(txt);
        } catch (_) {
            res.status(404).json({ error: 'Project not found' });
        }
    });

    r.put('/projects/:name', express.json({ limit: '5mb' }), async (req, res) => {
        const d = projectDir(req.params.name);
        if (!d) return res.status(400).json({ error: 'Invalid project name' });
        if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.items)) {
            return res.status(400).json({ error: 'Invalid project data' });
        }
        try {
            await fs.promises.mkdir(path.join(d, 'files'), { recursive: true });
            const tmp = path.join(d, 'project.pdset.tmp');
            await fs.promises.writeFile(tmp, JSON.stringify(req.body, null, 2));
            await fs.promises.rename(tmp, path.join(d, 'project.pdset')); // atomic
            res.json({ ok: true, folder: d });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // stored files are named by id: <id>.pdf (id = [a-z0-9]+)
    function filePath(req) {
        const d = projectDir(req.params.name);
        if (!d || !/^[a-z0-9]{4,40}$/i.test(req.params.id)) return null;
        return { dir: path.join(d, 'files'), file: path.join(d, 'files', req.params.id + '.pdf') };
    }

    r.put('/projects/:name/files/:id', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
        const p = filePath(req);
        if (!p) return res.status(400).json({ error: 'Invalid name' });
        if (!Buffer.isBuffer(req.body) || req.body.length < 8) return res.status(400).json({ error: 'Empty file' });
        try {
            await fs.promises.mkdir(p.dir, { recursive: true });
            await fs.promises.writeFile(p.file + '.tmp', req.body);
            await fs.promises.rename(p.file + '.tmp', p.file);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    r.get('/projects/:name/files/:id', (req, res) => {
        const p = filePath(req);
        if (!p) return res.status(400).json({ error: 'Invalid name' });
        res.sendFile(p.file, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'File not found' }); });
    });

    return r;
};

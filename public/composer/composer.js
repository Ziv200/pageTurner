(function () {
    'use strict';
    var C = window.ComposerCore;
    var PDFLib = window.PDFLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.js';

    var items = [];          // see makeItem
    var dirty = false;
    var dragId = null;

    var $ = function (id) { return document.getElementById(id); };
    var listEl = $('list'), nameEl = $('project-name'), noticeEl = $('notice');

    function makeItem(o) {
        return Object.assign({
            id: C.newId(), fileName: '', size: 0, lastModified: 0, pageRange: '', path: null,
            blob: null, pageCount: 0, status: 'missing', message: '', thumb: null, storedIn: null
        }, o);
    }

    function notice(msg, kind) {
        if (!msg) { noticeEl.hidden = true; return; }
        noticeEl.textContent = msg;
        noticeEl.className = 'notice' + (kind ? ' ' + kind : '');
        noticeEl.hidden = false;
    }
    function markDirty() { dirty = true; }
    window.addEventListener('beforeunload', function (e) {
        if (dirty && items.length) { e.preventDefault(); e.returnValue = ''; }
    });

    // ---------- loading PDFs ----------
    function readBlob(blob) {
        return new Promise(function (res, rej) {
            var r = new FileReader();
            r.onload = function () { res(r.result); };
            r.onerror = function () { rej(r.error || new Error('Cannot read file')); };
            r.readAsArrayBuffer(blob);
        });
    }

    // Attach a file/blob to an item: validate with pdf-lib, thumbnail with pdfjs.
    async function attach(item, blob) {
        item.blob = blob;
        item.thumb = null;
        try {
            var buf = await readBlob(blob);
            var doc;
            try {
                doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
            } catch (e) {
                if (e && /encrypt/i.test(e.name + ' ' + e.message)) throw new Error('Password-protected PDF – remove the password first');
                throw new Error('Damaged or unreadable PDF');
            }
            try { item.pageCount = doc.getPageCount(); } catch (e) { throw new Error('Damaged or unreadable PDF'); }
            if (!item.pageCount) throw new Error('PDF has no pages');
            item.status = 'ok';
            item.message = '';
            try { item.thumb = await makeThumb(buf); } catch (e) { console.warn('thumbnail failed', e); item.thumb = null; }
        } catch (e) {
            item.status = 'error';
            item.pageCount = 0;
            item.message = e.message;
        }
    }

    async function makeThumb(buf) {
        var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        try {
            var page = await pdf.getPage(1);
            var vp0 = page.getViewport({ scale: 1 });
            var scale = 168 / vp0.height;
            var vp = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            return canvas.toDataURL('image/jpeg', 0.7);
        } finally { pdf.destroy(); }
    }

    async function addFiles(fileList) {
        var files = Array.prototype.slice.call(fileList).filter(function (f) {
            return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
        });
        var skipped = fileList.length - files.length;
        if (!files.length) { notice('No PDF files found in that selection.', 'error'); return; }
        var matched = 0, changed = 0;
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var waiting = items.filter(function (it) { return it.status === 'missing' || it.status === 'changed'; });
            var m = C.matchMissing(f, waiting.filter(function (w) { return !w.blob; }));
            var item;
            if (m) {
                item = m.item; matched++;
                await attach(item, f);
                if (item.status === 'ok' && m.changed) {
                    item.status = 'changed';
                    item.message = 'This file is not the same size as when the project was saved. Check it.';
                    changed++;
                }
            } else {
                item = makeItem({ fileName: f.name, size: f.size, lastModified: f.lastModified });
                items.push(item);
                await attach(item, f);
            }
            item.size = f.size; item.lastModified = f.lastModified;
            render();
        }
        markDirty();
        var msg = [];
        if (matched) msg.push(matched + ' matched to the project');
        if (changed) msg.push(changed + ' differ in size from the saved one');
        if (skipped) msg.push(skipped + ' non-PDF skipped');
        notice(msg.join(' · '), changed || skipped ? '' : 'ok');
        if (!msg.length) notice('');
    }

    // ---------- rendering ----------
    function rangeCheck(it) {
        if (it.status !== 'ok' && it.status !== 'changed') return { ok: true, count: 0 };
        try { return { ok: true, count: C.parseRange(it.pageRange, it.pageCount).length }; }
        catch (e) { return { ok: false, error: e.message, count: 0 }; }
    }

    function render() {
        listEl.textContent = '';
        var totalPages = 0, problems = 0;
        items.forEach(function (it, idx) {
            var rc = rangeCheck(it);
            var usable = it.blob && (it.status === 'ok' || it.status === 'changed');
            if (!usable || !rc.ok) problems++;
            else totalPages += rc.count;

            var li = document.createElement('li');
            li.className = 'row' + (it.status === 'error' ? ' bad' : (it.status === 'missing' || it.status === 'changed') ? ' missing' : '');
            li.dataset.id = it.id;

            var handle = el('div', 'handle', '⠿'); handle.title = 'Drag to reorder'; handle.draggable = true;
            handle.addEventListener('dragstart', function (e) {
                dragId = it.id; li.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-composer-row', it.id);
                try { e.dataTransfer.setDragImage(li, 20, 20); } catch (_) {}
            });
            handle.addEventListener('dragend', function () { dragId = null; clearDropMarks(); li.classList.remove('dragging'); });
            li.addEventListener('dragover', function (e) {
                if (!dragId) return;
                e.preventDefault(); e.stopPropagation();
                var r = li.getBoundingClientRect();
                clearDropMarks();
                li.classList.add(e.clientY < r.top + r.height / 2 ? 'dropbefore' : 'dropafter');
            });
            li.addEventListener('drop', function (e) {
                if (!dragId) return;
                e.preventDefault(); e.stopPropagation();
                var after = li.classList.contains('dropafter');
                moveTo(dragId, it.id, after);
                dragId = null; clearDropMarks();
            });

            var thumb = el('div', 'thumb');
            if (it.thumb) { var img = new Image(); img.src = it.thumb; img.alt = ''; thumb.appendChild(img); }
            else thumb.textContent = it.status === 'error' ? 'error' : it.status === 'missing' ? 'missing' : 'PDF';

            var info = el('div', 'info');
            var nm = el('div', 'name', it.fileName); nm.title = it.fileName; nm.dir = 'auto';
            var meta = el('div', 'meta');
            if (it.status === 'error') meta.appendChild(el('span', 'err', it.message));
            else if (it.status === 'missing') meta.appendChild(el('span', 'warn', 'File not attached – drop or choose "' + it.fileName + '"' + (it.path ? ' (was: ' + it.path + ')' : '')));
            else {
                var txt = it.pageCount + ' page' + (it.pageCount === 1 ? '' : 's') + ' · ' + fmtSize(it.size);
                if (rc.ok && it.pageRange.trim()) txt += ' · using ' + rc.count;
                meta.appendChild(document.createTextNode(txt));
                if (it.status === 'changed') { meta.appendChild(document.createElement('br')); meta.appendChild(el('span', 'warn', it.message)); }
            }
            info.appendChild(nm); info.appendChild(meta);

            if (usable) {
                var range = el('div', 'range');
                range.appendChild(document.createTextNode('Pages:'));
                var inp = document.createElement('input');
                inp.type = 'text'; inp.placeholder = 'all (e.g. 1-3,5)'; inp.value = it.pageRange; inp.setAttribute('inputmode', 'text');
                inp.setAttribute('aria-label', 'Page range for ' + it.fileName);
                if (!rc.ok) inp.classList.add('invalid');
                inp.addEventListener('input', function () {
                    it.pageRange = inp.value; markDirty();
                    var r2 = rangeCheck(it);
                    inp.classList.toggle('invalid', !r2.ok);
                    errSpan.textContent = r2.ok ? '' : r2.error;
                    updateSummary();
                });
                var errSpan = el('span', 'err', rc.ok ? '' : rc.error);
                range.appendChild(inp); range.appendChild(errSpan);
                info.appendChild(range);
            }

            var actions = el('div', 'actions');
            actions.appendChild(btn('▲', 'Move up', idx === 0, function () { move(idx, -1); }));
            actions.appendChild(btn('▼', 'Move down', idx === items.length - 1, function () { move(idx, 1); }));
            actions.appendChild(btn('✕', 'Remove', false, function () { items.splice(idx, 1); markDirty(); render(); }));

            li.appendChild(handle); li.appendChild(thumb); li.appendChild(info); li.appendChild(actions);
            listEl.appendChild(li);
        });
        $('empty').hidden = items.length > 0;
        render.problems = problems; render.totalPages = totalPages;
        updateSummary();
    }

    function updateSummary() {
        var total = 0, problems = 0;
        items.forEach(function (it) {
            var rc = rangeCheck(it);
            var usable = it.blob && (it.status === 'ok' || it.status === 'changed');
            if (!usable || !rc.ok) problems++; else total += rc.count;
        });
        var s = items.length + ' file' + (items.length === 1 ? '' : 's') + ' · ' + total + ' page' + (total === 1 ? '' : 's');
        if (problems) s += ' · ' + problems + ' need attention';
        $('summary').textContent = s;
        $('btn-export').disabled = !items.length || problems > 0 || total === 0;
        $('btn-export').title = problems ? 'Fix or remove the files that need attention first' : '';
    }

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(label, title, disabled, fn) { var b = el('button', '', label); b.title = title; b.setAttribute('aria-label', title); b.disabled = disabled; b.addEventListener('click', fn); return b; }
    function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function clearDropMarks() { listEl.querySelectorAll('.dropbefore,.dropafter').forEach(function (x) { x.classList.remove('dropbefore', 'dropafter'); }); }

    function move(idx, d) {
        var j = idx + d; if (j < 0 || j >= items.length) return;
        var t = items[idx]; items[idx] = items[j]; items[j] = t; markDirty(); render();
    }
    function moveTo(srcId, targetId, after) {
        if (srcId === targetId) return;
        var si = items.findIndex(function (x) { return x.id === srcId; });
        var it = items.splice(si, 1)[0];
        var ti = items.findIndex(function (x) { return x.id === targetId; });
        items.splice(after ? ti + 1 : ti, 0, it);
        markDirty(); render();
    }

    // ---------- drop zone ----------
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
            if (dragId || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
            e.preventDefault(); drop.classList.add('over');
        });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        document.addEventListener(ev, function (e) { if (ev === 'drop' || e.target === document.documentElement || e.relatedTarget === null) drop.classList.remove('over'); });
    });
    document.addEventListener('drop', function (e) {
        if (dragId || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
    });
    $('btn-add').addEventListener('click', function () { $('file-pdf').click(); });
    $('file-pdf').addEventListener('change', function (e) { var f = e.target.files; if (f.length) addFiles(f); e.target.value = ''; });

    // ---------- project: new / save / open ----------
    function projectName() { return nameEl.value.trim() || 'Untitled'; }
    nameEl.addEventListener('input', markDirty);

    $('btn-new').addEventListener('click', function () {
        if (dirty && items.length && !confirm('Discard the current project?')) return;
        items = []; nameEl.value = 'Untitled'; dirty = false; notice(''); render();
    });

    function download(blob, filename) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }

    $('btn-save-file').addEventListener('click', function () {
        var data = C.buildPdset(projectName(), items, null);
        data.items.forEach(function (d, i) { d.path = items[i].path || null; });
        download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), C.safeFileBase(projectName()) + '.pdset');
        dirty = false;
        notice('Saved a .pdset file. It stores names and order only – keep the PDFs, or use "Save to Mac" to keep copies with the project.', '');
    });

    $('btn-open-file').addEventListener('click', function () { $('file-pdset').click(); });
    $('file-pdset').addEventListener('change', async function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try { loadProject(JSON.parse(await f.text()), null); }
        catch (err) { notice('Cannot open project: ' + err.message, 'error'); }
    });

    async function loadProject(data, storedProject) {
        var p = C.readPdset(data);
        items = p.items.map(function (d) {
            return makeItem({ id: d.id || C.newId(), fileName: String(d.fileName || 'unnamed.pdf'), size: d.size || 0, lastModified: d.lastModified || 0, pageRange: d.pageRange || '', path: d.path || null, status: 'missing' });
        });
        nameEl.value = p.name; render();
        if (storedProject) {
            var failed = 0;
            for (var i = 0; i < items.length; i++) {
                try {
                    var r = await fetch('/api/composer/projects/' + encodeURIComponent(storedProject) + '/files/' + items[i].id);
                    if (!r.ok) throw new Error('missing');
                    await attach(items[i], await r.blob());
                    items[i].storedIn = storedProject;
                } catch (e) { failed++; }
                render();
            }
            notice(failed ? failed + ' stored file(s) could not be loaded – drop the PDFs to re-attach them.' : 'Project opened from Mac.', failed ? 'error' : 'ok');
        } else {
            notice('Project opened. Drop or choose the PDFs again – files are matched by name and size.', '');
        }
        dirty = false;
    }

    $('btn-save-mac').addEventListener('click', async function () {
        var name = projectName();
        var bad = items.filter(function (it) { return !it.blob; });
        if (bad.length) { notice('Attach the missing PDFs before saving to the Mac (or use "Download .pdset").', 'error'); return; }
        var b = $('btn-save-mac'); b.disabled = true;
        try {
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.status === 'error') continue;
                if (it.storedIn === name) continue;
                notice('Saving ' + (i + 1) + ' of ' + items.length + '…');
                var r = await fetch('/api/composer/projects/' + encodeURIComponent(name) + '/files/' + it.id, { method: 'PUT', body: it.blob });
                if (!r.ok) throw new Error((await r.json().catch(function () { return {}; })).error || 'Upload failed');
            }
            var kept = items.filter(function (it) { return it.status !== 'error'; });
            var folderRes = await fetch('/api/composer/projects');
            var folder = (await folderRes.json()).root + '/' + name;
            var data = C.buildPdset(name, kept, folder);
            var pr = await fetch('/api/composer/projects/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (!pr.ok) throw new Error((await pr.json().catch(function () { return {}; })).error || 'Save failed');
            kept.forEach(function (it) { it.storedIn = name; it.path = folder + '/files/' + it.id + '.pdf'; });
            dirty = false;
            notice('Saved to ' + folder + (kept.length < items.length ? ' (files with errors were left out)' : ''), 'ok');
        } catch (e) { notice('Save failed: ' + e.message, 'error'); }
        b.disabled = false;
    });

    var dialog = $('dialog');
    $('dialog-close').addEventListener('click', function () { dialog.hidden = true; });
    $('btn-open-mac').addEventListener('click', async function () {
        var ul = $('project-list'); ul.textContent = '';
        try {
            var r = await (await fetch('/api/composer/projects')).json();
            if (!r.projects.length) ul.appendChild(el('li', 'hint', 'No saved projects yet in ' + r.root));
            r.projects.forEach(function (p) {
                var li = document.createElement('li');
                var b = el('button', '', p.name + '  –  ' + new Date(p.modified).toLocaleString());
                b.addEventListener('click', async function () {
                    if (dirty && items.length && !confirm('Discard the current project?')) return;
                    dialog.hidden = true;
                    try {
                        var d = await (await fetch('/api/composer/projects/' + encodeURIComponent(p.name))).json();
                        await loadProject(d, p.name);
                    } catch (e) { notice('Cannot open project: ' + e.message, 'error'); }
                });
                li.appendChild(b); ul.appendChild(li);
            });
        } catch (e) { ul.appendChild(el('li', 'hint', 'Could not list projects: ' + e.message)); }
        dialog.hidden = false;
    });

    // ---------- export ----------
    async function buildMerged() {
        var out = await PDFLib.PDFDocument.create();
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var src = await PDFLib.PDFDocument.load(await readBlob(it.blob), { updateMetadata: false });
            var idx = C.parseRange(it.pageRange, src.getPageCount());
            var pages = await out.copyPages(src, idx);
            pages.forEach(function (p) { out.addPage(p); });
        }
        return out.save();
    }
    window.__composerBuildMerged = buildMerged; // for tests

    $('btn-export').addEventListener('click', async function () {
        var b = $('btn-export'); b.disabled = true; var old = b.textContent; b.textContent = 'Merging…';
        try {
            var bytes = await buildMerged();
            download(new Blob([bytes], { type: 'application/pdf' }), C.safeFileBase(projectName()) + '.pdf');
            notice('Exported ' + C.safeFileBase(projectName()) + '.pdf', 'ok');
        } catch (e) { notice('Export failed: ' + e.message, 'error'); }
        b.textContent = old; updateSummary();
    });

    // test hooks (read-only helpers)
    window.__composer = { get items() { return items; }, addFiles: addFiles };
    render();
})();

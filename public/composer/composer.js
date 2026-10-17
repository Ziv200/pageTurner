(function () {
    'use strict';
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.js';
    var API = '/api/composer';
    var $ = function (id) { return document.getElementById(id); };

    var state = { files: [], rows: [], nextId: 1, nextFileId: 1 };
    var projectActiveName = null;   // name of project active on server
    var savedName = null;           // name it was last saved as
    var dirty = false;              // table changed since last save
    var tbody = $('rows');

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function markDirty() { dirty = true; }
    window.addEventListener('beforeunload', function (e) { if (dirty && state.rows.length) { e.preventDefault(); e.returnValue = ''; } });

    var noticeEl = $('notice');
    function notice(msg, kind) {
        if (!msg) { noticeEl.hidden = true; return; }
        noticeEl.textContent = msg; noticeEl.className = 'notice' + (kind ? ' ' + kind : ''); noticeEl.hidden = false;
    }
    function api(path, opts) {
        return fetch(API + path, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
                return j;
            });
        });
    }
    function jsonOpts(method, body) { return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

    // ---------- rows ----------
    function newRow(o) { return Object.assign({ id: state.nextId++, pc: '', song: '', page: '1' }, o); }
    function fileInfo(song) {
        for (var i = 0; i < state.files.length; i++) if (state.files[i].name === song) return state.files[i];
        return null;
    }
    function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function toInt(v) { return /^\s*\d+\s*$/.test(String(v)) ? parseInt(v, 10) : NaN; }

    // returns per-row {level:'ok'|'warn'|'bad', msg, pcErr, songErr, pageErr}; fatal = problems that block saving
    function validate() {
        var counts = {};
        state.rows.forEach(function (r) { var n = toInt(r.pc); if (!isNaN(n)) counts[n] = (counts[n] || 0) + 1; });
        var out = {}; var fatal = 0;
        state.rows.forEach(function (r) {
            var v = { level: 'ok', msg: '' };
            var pc = toInt(r.pc), pg = toInt(r.page);
            function bad(m, f) { v.level = 'bad'; v.msg = v.msg || m; if (f) v[f] = true; }
            if (isNaN(pc) || pc < 0 || pc > 127) { bad('Program Change must be a whole number 0-127', 'pcErr'); fatal++; }
            else if (counts[pc] > 1) { bad('Duplicate Program Change ' + pc + ' - each number can be used once', 'pcErr'); fatal++; }
            if (!r.song) { bad('Choose a song', 'songErr'); fatal++; }
            if (isNaN(pg) || pg < 1) { bad('Page must be a whole number, 1 or more', 'pageErr'); fatal++; }
            if (r.song) {
                var fi = fileInfo(r.song);
                if (!fi) bad('PDF not loaded in this project: ' + r.song, 'songErr');
                else if (fi && fi.error) bad(r.song + ' is damaged or unreadable', 'songErr');
                else if (fi && !isNaN(pg) && pg > fi.pages) {
                    if (v.level === 'ok') v.level = 'warn';
                    v.msg = v.msg || 'Only ' + fi.pages + ' page' + (fi.pages === 1 ? '' : 's') + ' in this PDF'; v.pageErr = true;
                }
            }
            out[r.id] = v;
        });
        out.fatal = fatal;
        return out;
    }

    // ---------- thumbnails ----------
    var docs = {}, thumbs = {}, thumbQueue = [], thumbBusy = false;
    function thumbKey(fi, page) { return fi.uid + '|' + page; }
    function getDoc(fi) {
        if (!docs[fi.uid]) docs[fi.uid] = fi.blob.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; });
        return docs[fi.uid];
    }
    function queueThumb(fi, page, box) {
        thumbQueue.push({ fi: fi, page: page, box: box });
        if (!thumbBusy) runThumbs();
    }
    function runThumbs() {
        var job = thumbQueue.shift();
        if (!job) { thumbBusy = false; return; }
        thumbBusy = true;
        var fi = job.fi, key = thumbKey(fi, job.page);
        function done(url) {
            if (url && job.box.isConnected) { var img = new Image(); img.src = url; job.box.textContent = ''; job.box.appendChild(img); }
            runThumbs();
        }
        if (state.files.indexOf(fi) < 0) return done(null);
        if (thumbs[key]) return done(thumbs[key]);
        getDoc(fi).then(function (doc) {
            if (job.page > doc.numPages) return null;
            return doc.getPage(job.page).then(function (pg) {
                var vp0 = pg.getViewport({ scale: 1 });
                var sc = 120 / vp0.height;
                var vp = pg.getViewport({ scale: sc });
                var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
                return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { return c.toDataURL('image/png'); });
            });
        }).then(function (url) { if (url) thumbs[key] = url; done(url); }, function () { delete docs[fi.uid]; job.box.textContent = '?'; runThumbs(); });
    }

    // ---------- rendering ----------
    var rowEls = {};
    function songSelect(r) {
        var sel = el('select');
        var names = state.files.map(function (f) { return f.name; });
        var blank = el('option', '', state.files.length ? '— choose song —' : '— load PDFs first —'); blank.value = ''; sel.appendChild(blank);
        names.forEach(function (n) { var o = el('option', '', n); o.value = n; sel.appendChild(o); });
        sel.value = r.song;
        sel.addEventListener('change', function () { r.song = sel.value; markDirty(); refresh(); });
        return sel;
    }
    function buildRow(r) {
        var tr = el('tr'); tr.dataset.id = r.id;
        var tdT = el('td', 'c-thumb'); var th = el('div', 'thumb'); tdT.appendChild(th); tr.appendChild(tdT);
        var tdPc = el('td', 'c-pc'); var pc = el('input', 'pcin'); pc.type = 'number'; pc.min = 0; pc.max = 127; pc.step = 1; pc.value = r.pc; pc.setAttribute('aria-label', 'Program Change');
        pc.addEventListener('input', function () { r.pc = pc.value; markDirty(); refresh(true); }); tdPc.appendChild(pc); tr.appendChild(tdPc);
        var tdS = el('td', 'c-song'); tdS.appendChild(songSelect(r)); tdS.appendChild(el('div', 'msg')); tr.appendChild(tdS);
        var tdG = el('td', 'c-page'); var pg = el('input', 'pgin'); pg.type = 'number'; pg.min = 1; pg.step = 1; pg.value = r.page; pg.setAttribute('aria-label', 'Page');
        pg.addEventListener('input', function () { r.page = pg.value; markDirty(); refresh(true); });
        tdG.appendChild(pg); var of = el('span', 'hint', ''); of.className = 'hint pageof'; tdG.appendChild(of); tr.appendChild(tdG);
        var tdA = el('td', 'c-actions');
        var test = el('button', 'small', 'Test'); test.title = 'Simulate this Program Change on the server'; test.addEventListener('click', function () { testPc(r); });
        var dup = el('button', 'small', 'Duplicate'); dup.addEventListener('click', function () {
            var i = state.rows.indexOf(r); state.rows.splice(i + 1, 0, newRow({ pc: '', song: r.song, page: r.page })); markDirty(); rebuild();
        });
        var del = el('button', 'small', '✕'); del.title = 'Remove row'; del.addEventListener('click', function () { state.rows.splice(state.rows.indexOf(r), 1); markDirty(); rebuild(); });
        tdA.appendChild(test); tdA.appendChild(dup); tdA.appendChild(del); tr.appendChild(tdA);
        rowEls[r.id] = { tr: tr, thumb: th, thumbFor: null, pc: pc, pg: pg, msg: tdS.querySelector('.msg'), pageof: of };
        return tr;
    }
    function rebuild() {
        tbody.textContent = ''; rowEls = {};
        state.rows.forEach(function (r) { tbody.appendChild(buildRow(r)); });
        $('empty').hidden = state.rows.length > 0;
        refresh();
    }
    // update classes/messages/thumbs in place (keeps focus while typing)
    function refresh(keepFocus) {
        var v = validate();
        state.rows.forEach(function (r) {
            var e = rowEls[r.id]; if (!e) return;
            var x = v[r.id];
            e.tr.className = x.level === 'ok' ? '' : x.level;
            e.pc.classList.toggle('err', !!x.pcErr);
            e.pg.classList.toggle('err', !!x.pageErr);
            e.tr.querySelector('select').classList.toggle('err', !!x.songErr);
            e.msg.textContent = x.msg;
            var fi = r.song ? fileInfo(r.song) : null;
            e.pageof.textContent = fi && !fi.error ? ' of ' + fi.pages : '';
            var pg = toInt(r.page);
            var want = (fi && !fi.error && !isNaN(pg) && pg >= 1 && pg <= fi.pages) ? fi.uid + '|' + pg : '';
            if (want !== e.thumbFor) {
                e.thumbFor = want; e.thumb.textContent = '';
                if (want) {
                    if (thumbs[thumbKey(fi, pg)]) { var img = new Image(); img.src = thumbs[thumbKey(fi, pg)]; e.thumb.appendChild(img); }
                    else queueThumb(fi, pg, e.thumb);
                }
            }
        });
        // auto-fill song list
        var fs = $('fill-song'), cur = fs.value; fs.textContent = '';
        state.files.forEach(function (f) { var o = el('option', '', f.name + (f.error ? '' : ' (' + f.pages + ')')); o.value = f.name; fs.appendChild(o); });
        if (cur) fs.value = cur;
        $('empty').hidden = state.rows.length > 0;
        renderFiles();
        $('btn-activate').disabled = false;
        $('btn-save-mac').disabled = false;
        return v;
    }

    // ---------- PDFs ----------
    function cleanName(raw) {
        var n = String(raw || '').replace(/[\u0000-\u001f\/\\:*?"<>|]/g, '_').trim().replace(/^\.+/, '').trim();
        if (!/\.pdf$/i.test(n)) n += '.pdf';
        if (n.length > 200) n = n.slice(0, 190) + '.pdf';
        return n.replace(/^\.pdf$/i, 'document.pdf');
    }
    function uniqueName(raw) {
        var n = cleanName(raw), base = n.replace(/\.pdf$/i, ''), k = 2;
        function taken(x) { return state.files.some(function (f) { return f.name.toLowerCase() === x.toLowerCase(); }); }
        while (taken(n)) n = base + ' (' + (k++) + ').pdf';
        return n;
    }
    function checkPdf(blob) {
        return blob.slice(0, 1024).arrayBuffer().then(function (b) {
            var t = new TextDecoder('latin1').decode(b);
            if (t.indexOf('%PDF-') < 0) return { error: 'Not a PDF file' };
            return blob.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; }).then(function (doc) {
                return { pages: doc.numPages, doc: doc };
            }, function (e) { return { error: e && e.name === 'PasswordException' ? 'Password-protected PDF' : 'Damaged or unreadable PDF' }; });
        });
    }
    function addFiles(list) {
        var arr = Array.prototype.slice.call(list);
        var pdfs = arr.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
        var skipped = arr.length - pdfs.length;
        if (!pdfs.length) { if (arr.length) notice('Only PDF files can be added (' + skipped + ' ignored).', 'error'); return Promise.resolve(); }
        var renamed = 0, bad = [], i = 0;
        return new Promise(function (resolve) {
            function next() {
                if (i >= pdfs.length) {
                    $('pdf-summary').textContent = '';
                    markDirty(); rebuild();
                    var msg = 'Added ' + (pdfs.length - bad.length) + ' PDF' + (pdfs.length - bad.length === 1 ? '' : 's') + '.';
                    if (renamed) msg += ' ' + renamed + ' renamed because the name was already used.';
                    if (skipped) msg += ' ' + skipped + ' non-PDF file' + (skipped === 1 ? '' : 's') + ' ignored.';
                    if (bad.length) msg += ' Problem: ' + bad.join('; ') + '.';
                    notice(msg, bad.length ? 'error' : 'ok');
                    return resolve();
                }
                var f = pdfs[i++];
                $('pdf-summary').textContent = 'Reading ' + f.name + ' (' + i + '/' + pdfs.length + ')…';
                var name = uniqueName(f.name); if (name !== f.name) renamed++;
                // copy into memory-backed blob so the original may be deleted afterwards
                f.arrayBuffer().then(function (buf) {
                    var blob = new Blob([buf], { type: 'application/pdf' });
                    return checkPdf(blob).then(function (r) {
                        if (r.error === 'Not a PDF file') { bad.push(f.name + ' is not a PDF'); return; }
                        var fi = { uid: state.nextFileId++, name: name, size: blob.size, pages: r.pages || 0, error: r.error || null, blob: blob };
                        if (r.doc) docs[fi.uid] = Promise.resolve(r.doc);
                        state.files.push(fi);
                        if (r.error) bad.push(name + ': ' + r.error);
                    });
                }).catch(function () { bad.push(f.name + ' could not be read'); }).then(next);
            }
            next();
        });
    }
    function removeFile(fi) {
        var users = state.rows.filter(function (r) { return r.song === fi.name; });
        if (users.length && !confirm('"' + fi.name + '" is used by ' + users.length + ' table row' + (users.length === 1 ? '' : 's') + ' (PC ' + users.map(function (r) { return r.pc; }).join(', ') + '). Removing it also deletes those rows. Continue?')) return;
        state.rows = state.rows.filter(function (r) { return r.song !== fi.name; });
        state.files.splice(state.files.indexOf(fi), 1);
        var d = docs[fi.uid]; delete docs[fi.uid];
        if (d) d.then(function (doc) { doc.destroy(); }, function () {});
        markDirty(); rebuild();
    }
    function totalBytes() { return state.files.reduce(function (a, f) { return a + f.size; }, 0); }
    function renderFiles() {
        var bar = $('filebar'), ul = $('pdf-list');
        bar.hidden = !state.files.length;
        ul.textContent = '';
        state.files.forEach(function (f) {
            var li = el('li');
            li.appendChild(el('span', 'nm' + (f.error ? ' bad' : ''), f.name));
            li.appendChild(el('span', 'hint', f.error ? f.error : f.pages + ' page' + (f.pages === 1 ? '' : 's')));
            li.appendChild(el('span', 'hint', fmtSize(f.size)));
            var x = el('button', 'small', '✕'); x.title = 'Remove this PDF from the project'; x.addEventListener('click', function () { removeFile(f); });
            li.appendChild(x); ul.appendChild(li);
        });
        if (!/^Reading|^Saving|^Opening/.test($('pdf-summary').textContent))
            $('pdf-summary').textContent = state.files.length + ' PDF' + (state.files.length === 1 ? '' : 's') + ' in project · total size ' + fmtSize(totalBytes());
    }
    $('btn-add-pdfs').addEventListener('click', function () { $('file-pdfs').click(); });
    $('file-pdfs').addEventListener('change', function (e) { var l = Array.prototype.slice.call(e.target.files); e.target.value = ''; if (l.length) addFiles(l); });
    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (t) { window.addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); dz.classList.add('over'); } }); });
    ['dragleave', 'drop'].forEach(function (t) { window.addEventListener(t, function (e) { if (t === 'drop' || e.target === document.documentElement || !e.relatedTarget) dz.classList.remove('over'); }); });
    window.addEventListener('drop', function (e) {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault(); addFiles(e.dataTransfer.files);
    });

    // ---------- dialogs ----------
    var dialog = $('dialog');
    function openDialog(title) {
        $('dialog-title').textContent = title; $('dialog-body').textContent = '';
        dialog.hidden = false;
    }
    $('dialog-close').addEventListener('click', function () { dialog.hidden = true; });

    // ---------- table toolbar ----------
    $('btn-add-row').addEventListener('click', function () {
        var used = {}; state.rows.forEach(function (r) { used[r.pc] = 1; });
        var n = 0; while (used[n] && n < 127) n++;
        var last = state.rows[state.rows.length - 1];
        state.rows.push(newRow({ pc: String(n), song: last ? last.song : (state.files[0] ? state.files[0].name : ''), page: '1' }));
        markDirty(); rebuild();
    });
    $('btn-sort').addEventListener('click', function () {
        state.rows.sort(function (a, b) { var x = toInt(a.pc), y = toInt(b.pc); return (isNaN(x) ? 999 : x) - (isNaN(y) ? 999 : y); });
        markDirty(); rebuild();
    });
    $('btn-fill').addEventListener('click', function () {
        var song = $('fill-song').value, fi = fileInfo(song), start = toInt($('fill-start').value);
        if (!fi || fi.error) return notice('Choose a readable song to auto-fill.', 'error');
        if (isNaN(start) || start < 0) return notice('Start number must be 0-127.', 'error');
        if (start + fi.pages - 1 > 127) return notice('Not enough numbers: ' + fi.pages + ' pages from ' + start + ' goes beyond 127. Nothing added.', 'error');
        for (var p = 1; p <= fi.pages; p++) state.rows.push(newRow({ pc: String(start + p - 1), song: song, page: String(p) }));
        markDirty(); rebuild();
        notice('Added ' + fi.pages + ' rows for ' + song + ' (PC ' + start + '–' + (start + fi.pages - 1) + ').' + (hasDup() ? ' Some numbers are already used – see the red rows.' : ''), hasDup() ? '' : 'ok');
    });
    $('btn-add-all').addEventListener('click', function () {
        if (!state.files.length) return;
        var used = {}, added = 0, skipped = 0, bad = 0, full = false;
        state.rows.forEach(function (r) { var n = toInt(r.pc); if (!isNaN(n)) used[n] = true; });
        state.files.forEach(function (f) {
            if (full) return;
            if (state.rows.some(function (r) { return r.song === f.name; })) { skipped++; return; }
            if (f.error) { bad++; return; }
            var pc = 0; while (pc <= 127 && used[pc]) pc++;
            if (pc > 127) { full = true; return; }
            used[pc] = true; state.rows.push(newRow({ pc: String(pc), song: f.name, page: '1' })); added++;
        });
        if (added) { markDirty(); rebuild(); }
        var msg = 'Added ' + added + ' song' + (added === 1 ? '' : 's') + ', skipped ' + skipped + ' already in the table' + (bad ? ' (' + bad + ' unreadable PDF' + (bad === 1 ? '' : 's') + ' ignored)' : '') + '.';
        if (full) msg += ' Warning: no free Program Change numbers left (0–127); remaining songs were not added.';
        notice(msg, full ? 'error' : 'ok');
    });
    function hasDup() { var v = validate(); return state.rows.some(function (r) { return v[r.id].pcErr; }); }

    // ---------- projects ----------
    var MAGIC = [0x50, 0x44, 0x53, 0x45, 0x54, 0x33, 0, 0]; // "PDSET3\0\0"
    var nameEl = $('project-name');
    function projectName() { return nameEl.value.trim() || 'Untitled'; }
    function header() {
        return {
            version: 3, name: projectName(),
            rows: state.rows.map(function (r) { return { pc: toInt(r.pc), song: r.song, page: toInt(r.page) }; }),
            pdfs: state.files.map(function (f) { var o = { name: f.name, size: f.size, pages: f.pages }; if (f.error) o.error = true; return o; })
        };
    }
    // Container = magic + header length + header JSON + the PDFs. Built from Blob parts, so PDF data is never copied in memory.
    function buildContainer() {
        var hb = new TextEncoder().encode(JSON.stringify(header()));
        var len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, hb.length, false);
        return new Blob([new Uint8Array(MAGIC), len, hb].concat(state.files.map(function (f) { return f.blob; })), { type: 'application/octet-stream' });
    }
    function canSave() {
        var v = validate();
        if (!state.files.length) { notice('Load some PDFs first.', 'error'); return false; }
        if (v.fatal) { notice('Fix the red rows first (duplicate or invalid numbers, or no song chosen).', 'error'); return false; }
        return true;
    }
    function upload(name, blob) {
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest();
            x.open('PUT', API + '/projects/' + encodeURIComponent(name));
            x.setRequestHeader('Content-Type', 'application/octet-stream');
            var bar = $('progress'); bar.hidden = false; var inner = bar.firstChild;
            x.upload.onprogress = function (e) { if (e.lengthComputable) { inner.style.width = (100 * e.loaded / e.total) + '%'; notice('Saving… ' + fmtSize(e.loaded) + ' of ' + fmtSize(e.total), ''); } };
            x.onload = function () { bar.hidden = true; var j = {}; try { j = JSON.parse(x.responseText); } catch (_) {} x.status >= 200 && x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Request failed (' + x.status + ')')); };
            x.onerror = function () { bar.hidden = true; reject(new Error('Could not reach the server')); };
            x.send(blob);
        });
    }
    var saving = false;
    function saveToMac() {
        if (saving || !canSave()) return Promise.resolve(false);
        saving = true;
        var name = projectName();
        return upload(name, buildContainer()).then(function (j) {
            saving = false; savedName = name; dirty = false;
            var v = validate(), probs = state.rows.filter(function (r) { return v[r.id].level !== 'ok'; }).length;
            notice('Saved ' + j.file + ' (' + fmtSize(j.size) + ', ' + j.pdfs + ' PDF' + (j.pdfs === 1 ? '' : 's') + ' inside)' + (probs ? ' – ' + probs + ' row' + (probs === 1 ? ' has' : 's have') + ' warnings' : ''), probs ? '' : 'ok');
            return true;
        }, function (e) { saving = false; notice('Save failed: ' + e.message, 'error'); return false; });
    }
    $('btn-save-mac').addEventListener('click', saveToMac);
    $('btn-activate').addEventListener('click', function () {
        saveToMac().then(function (ok) {
            if (!ok) return;
            return api('/active', jsonOpts('POST', { name: projectName() })).then(function () {
                notice('"' + projectName() + '" is now active in PageTurner. Program Changes select songs from this table.', 'ok'); loadActive();
            }, function (e) { notice('Could not activate: ' + e.message, 'error'); });
        });
    });
    $('btn-deactivate').addEventListener('click', function () {
        api('/active', jsonOpts('POST', { name: null })).then(function () { notice('Project deactivated - viewer uses plain Program Change → page.', 'ok'); loadActive(); }, function (e) { notice(e.message, 'error'); });
    });
    function loadActive() {
        return fetch(API + '/active').then(function (r) { return r.json(); }).then(function (a) {
            projectActiveName = a.active ? a.name : null;
            var b = $('active-banner');
            b.textContent = a.active ? 'Active in PageTurner: ' + a.name : 'No active project – viewer uses plain Program Change → page';
            b.className = 'banner' + (a.active ? ' on' : '');
            $('btn-deactivate').hidden = !a.active;
        }).catch(function () {});
    }
    function testPc(r) {
        var pc = toInt(r.pc);
        if (isNaN(pc)) return notice('Enter a valid Program Change number first.', 'error');
        if (dirty || projectActiveName !== projectName()) return notice('Test uses the saved, active project. Press "Save & set active" first.', '');
        api('/test-pc', jsonOpts('POST', { pc: pc })).then(function (j) {
            notice(j.found ? 'Sent PC ' + pc + ' → ' + j.song + ' page ' + j.page : 'PC ' + pc + ' is not in the active project', j.found ? 'ok' : '');
        }, function (e) { notice(e.message, 'error'); });
    }
    function resetFiles() { docs = {}; thumbs = {}; thumbQueue = []; state.files = []; }
    function applyProject(h, blobs, savedAs) {
        resetFiles();
        nameEl.value = h.name || 'Untitled';
        h.pdfs.forEach(function (p, i) { state.files.push({ uid: state.nextFileId++, name: p.name, size: p.size, pages: p.pages, error: p.error ? 'Damaged or unreadable PDF' : null, blob: blobs[i] }); });
        state.rows = h.rows.map(function (r) { return newRow({ pc: String(r.pc), song: r.song, page: String(r.page) }); });
        savedName = savedAs || null; dirty = false;
        $('pdf-summary').textContent = ''; rebuild();
    }
    $('btn-new').addEventListener('click', function () {
        if (dirty && (state.rows.length || state.files.length) && !confirm('Discard unsaved changes?')) return;
        resetFiles(); state.rows = []; nameEl.value = 'Untitled'; dirty = false; savedName = null; notice(''); rebuild();
    });
    // Open from ~/PageTurnerProjects: header first, then each PDF is fetched into memory-backed blobs.
    function openFromMac(name, onlyIfIdle) {
        var h;
        return api('/projects/' + encodeURIComponent(name)).then(function (d) {
            h = d; var blobs = [], done = 0;
            $('pdf-summary').textContent = 'Opening ' + name + '…';
            return h.pdfs.reduce(function (p, f, i) {
                return p.then(function () {
                    return fetch(API + '/projects/' + encodeURIComponent(name) + '/pdf/' + i).then(function (r) {
                        if (!r.ok) throw new Error('Could not read ' + f.name); return r.blob();
                    }).then(function (b) { blobs[i] = b; done++; notice('Opening… ' + done + ' of ' + h.pdfs.length + ' PDFs', ''); });
                });
            }, Promise.resolve()).then(function () { return blobs; });
        }).then(function (blobs) {
            if (onlyIfIdle && (dirty || state.files.length)) return; // user already started working
            applyProject(h, blobs, name); notice('Opened "' + name + '" (' + fmtSize(h.totalBytes) + '). Everything is stored inside the project file.', 'ok'); });
    }
    $('btn-open-mac').addEventListener('click', function () {
        openDialog('Open project');
        api('/projects').then(function (j) {
            var body = $('dialog-body'); body.textContent = '';
            body.appendChild(el('div', 'hint', j.root));
            var ul = el('ul'); if (!j.projects.length) ul.appendChild(el('li', '', 'No saved projects yet'));
            j.projects.forEach(function (p) {
                var li = el('li'); li.appendChild(el('span', '', p.name + (p.name === j.active ? '  (active)' : '')));
                li.appendChild(el('span', 'hint', fmtSize(p.size) + ' · ' + new Date(p.modified).toLocaleString()));
                li.addEventListener('click', function () {
                    if (dirty && (state.rows.length || state.files.length) && !confirm('Discard unsaved changes?')) return;
                    dialog.hidden = true; notice('');
                    openFromMac(p.name).then(loadActive).catch(function (e) { $('pdf-summary').textContent = ''; renderFiles(); notice('Cannot open "' + p.name + '": ' + e.message, 'error'); });
                });
                ul.appendChild(li);
            });
            body.appendChild(ul);
        }, function (e) { $('dialog-body').textContent = e.message; });
    });
    $('btn-save-file').addEventListener('click', function () {
        if (!canSave()) return;
        var a = document.createElement('a'); a.href = URL.createObjectURL(buildContainer());
        a.download = projectName() + '.pdset'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    });
    $('btn-open-file').addEventListener('click', function () { $('file-pdset').click(); });
    // Parse a .pdset picked from disk (any folder). Same checks as the server.
    function readPdsetFile(f) {
        function bad(m) { return Promise.reject(new Error(m)); }
        return f.slice(0, 12).arrayBuffer().then(function (top) {
            var t = new Uint8Array(top);
            if (t.length < 12 || MAGIC.some(function (b, i) { return t[i] !== b; })) {
                return f.slice(0, 64).text().then(function (x) {
                    return bad(x.trim().charAt(0) === '{' ? 'This is an older (version 2) project that depends on a folder. Please re-create it by loading the PDFs and saving again.' : 'Not a PageTurner .pdset file');
                });
            }
            var hl = new DataView(top).getUint32(8, false);
            if (hl < 2 || hl > 4194304 || 12 + hl > f.size) return bad('Project file is damaged (bad header)');
            return f.slice(12, 12 + hl).text().then(function (txt) {
                var h; try { h = JSON.parse(txt); } catch (_) { return bad('Project file is damaged (unreadable header)'); }
                if (!h || h.version !== 3 || !Array.isArray(h.pdfs) || !Array.isArray(h.rows)) return bad('Unsupported project version');
                var off = 12 + hl, names = {};
                h.pdfs.forEach(function (p) { p._start = off; off += p.size; names[p.name] = 1; });
                if (off !== f.size) return bad('Project file is damaged (size mismatch - incomplete copy?)');
                if (h.rows.some(function (r) { return !names[r.song]; })) return bad('Project file is damaged (a row points to a missing PDF)');
                return Promise.all(h.pdfs.map(function (p) { return f.slice(p._start, p._start + p.size).arrayBuffer().then(function (b) { return new Blob([b], { type: 'application/pdf' }); }); }))
                    .then(function (blobs) { return { h: h, blobs: blobs }; });
            });
        });
    }
    $('file-pdset').addEventListener('change', function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        if (dirty && (state.rows.length || state.files.length) && !confirm('Discard unsaved changes?')) return;
        notice('Opening ' + f.name + '…', '');
        readPdsetFile(f).then(function (r) {
            var nm = f.name.replace(/\.pdset$/i, ''); if (!r.h.name) r.h.name = nm;
            applyProject(r.h, r.blobs, null); markDirty();
            notice('Opened ' + f.name + ' (' + fmtSize(f.size) + '). Press "Save as project" to store it in ~/PageTurnerProjects.', 'ok');
        }, function (err) { notice('Cannot open file: ' + err.message, 'error'); });
    });

    // start
    loadActive();
    api('/projects').then(function (j) {
        if (j.active) return openFromMac(j.active, true);
    }).catch(function () { $('pdf-summary').textContent = ''; });
    rebuild();
    window.__composer = { state: state, validate: validate, addFiles: addFiles };
})();

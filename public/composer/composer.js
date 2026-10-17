(function () {
    'use strict';
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.js';
    var API = '/api/composer';
    var $ = function (id) { return document.getElementById(id); };

    var state = { folder: '', files: null, folderError: '', rows: [], nextId: 1 };
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
        if (!state.files) return null;
        for (var i = 0; i < state.files.length; i++) if (state.files[i].name === song) return state.files[i];
        return null;
    }
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
                if (state.folderError) bad(state.folderError, 'songErr');
                else if (state.files && !fi) bad('File not found in the folder: ' + r.song, 'songErr');
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
    function pdfUrl(song) { return API + '/pdf?folder=' + encodeURIComponent(state.folder) + '&name=' + encodeURIComponent(song); }
    function thumbKey(song, page) { return state.folder + '|' + song + '|' + page; }
    function queueThumb(song, page, box) {
        thumbQueue.push({ song: song, page: page, box: box, folder: state.folder });
        if (!thumbBusy) runThumbs();
    }
    function runThumbs() {
        var job = thumbQueue.shift();
        if (!job) { thumbBusy = false; return; }
        thumbBusy = true;
        var key = thumbKey(job.song, job.page);
        function done(url) {
            if (url && job.box.isConnected) { var img = new Image(); img.src = url; job.box.textContent = ''; job.box.appendChild(img); }
            runThumbs();
        }
        if (job.folder !== state.folder) return done(null);
        if (thumbs[key]) return done(thumbs[key]);
        var dk = job.folder + '|' + job.song;
        if (!docs[dk]) docs[dk] = pdfjsLib.getDocument(pdfUrl(job.song)).promise;
        docs[dk].then(function (doc) {
            if (job.page > doc.numPages) return null;
            return doc.getPage(job.page).then(function (pg) {
                var vp0 = pg.getViewport({ scale: 1 });
                var sc = 120 / vp0.height;
                var vp = pg.getViewport({ scale: sc });
                var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
                return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { return c.toDataURL('image/png'); });
            });
        }).then(function (url) { if (url) thumbs[key] = url; done(url); }, function () { delete docs[dk]; job.box.textContent = '?'; runThumbs(); });
    }

    // ---------- rendering ----------
    var rowEls = {};
    function songSelect(r) {
        var sel = el('select');
        var names = state.files ? state.files.map(function (f) { return f.name; }) : [];
        var blank = el('option', '', state.files ? '— choose song —' : '— load a folder first —'); blank.value = ''; sel.appendChild(blank);
        names.forEach(function (n) { var o = el('option', '', n); o.value = n; sel.appendChild(o); });
        if (r.song && names.indexOf(r.song) < 0) { var o = el('option', '', r.song + '  (missing)'); o.value = r.song; sel.appendChild(o); }
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
            var want = (fi && !fi.error && !isNaN(pg) && pg >= 1 && pg <= fi.pages) ? r.song + '|' + pg : '';
            if (want !== e.thumbFor) {
                e.thumbFor = want; e.thumb.textContent = '';
                if (want) {
                    if (thumbs[thumbKey(r.song, pg)]) { var img = new Image(); img.src = thumbs[thumbKey(r.song, pg)]; e.thumb.appendChild(img); }
                    else queueThumb(r.song, pg, e.thumb);
                }
            }
        });
        // auto-fill song list
        var fs = $('fill-song'), cur = fs.value; fs.textContent = '';
        (state.files || []).forEach(function (f) { var o = el('option', '', f.name + (f.error ? '' : ' (' + f.pages + ')')); o.value = f.name; fs.appendChild(o); });
        if (cur) fs.value = cur;
        $('empty').hidden = state.rows.length > 0;
        $('btn-activate').disabled = false;
        $('btn-save-mac').disabled = false;
        return v;
    }

    // ---------- folder ----------
    function loadFolder(p, quiet) {
        state.folderError = ''; $('folder-status').textContent = 'Reading folder…';
        docs = {}; thumbs = {}; thumbQueue = [];
        return api('/folder?path=' + encodeURIComponent(p)).then(function (j) {
            state.folder = j.path; state.files = j.files; $('folder-path').value = j.path;
            var ok = j.files.filter(function (f) { return !f.error; }).length;
            $('folder-status').textContent = j.files.length + ' PDF' + (j.files.length === 1 ? '' : 's') + ' found' + (ok < j.files.length ? ' (' + (j.files.length - ok) + ' unreadable)' : '');
            if (!j.files.length) notice('This folder has no PDF files.', '');
            else if (!quiet) notice('');
            rebuild();
        }, function (e) {
            state.folder = p; state.files = []; state.folderError = 'Folder problem: ' + e.message;
            $('folder-status').textContent = state.folderError;
            notice(state.folderError, 'error');
            rebuild();
        });
    }
    $('btn-load-folder').addEventListener('click', function () { var p = $('folder-path').value.trim(); if (p) { markDirty(); loadFolder(p); } });
    $('folder-path').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-load-folder').click(); });

    // ---------- dialogs ----------
    var dialog = $('dialog');
    function openDialog(title, okLabel) {
        $('dialog-title').textContent = title; $('dialog-body').textContent = '';
        var ok = $('dialog-ok'); ok.hidden = !okLabel; if (okLabel) ok.textContent = okLabel;
        dialog.hidden = false;
    }
    $('dialog-close').addEventListener('click', function () { dialog.hidden = true; });
    var browsePath = null;
    function browse(p) {
        api('/browse' + (p ? '?path=' + encodeURIComponent(p) : '')).then(function (j) {
            browsePath = j.path;
            var body = $('dialog-body'); body.textContent = '';
            body.appendChild(el('div', 'cwd', j.path));
            body.appendChild(el('div', 'hint', j.pdfCount + ' PDF' + (j.pdfCount === 1 ? '' : 's') + ' in this folder'));
            var bar = el('div', 'buttons');
            var up = el('button', 'small', '↑ Up'); up.disabled = !j.parent; up.addEventListener('click', function () { browse(j.parent); });
            var home = el('button', 'small', 'Home'); home.addEventListener('click', function () { browse(j.home); });
            bar.appendChild(up); bar.appendChild(home); body.appendChild(bar);
            var ul = el('ul');
            if (!j.dirs.length) ul.appendChild(el('li', '', '(no sub-folders)'));
            j.dirs.forEach(function (d) { var li = el('li', '', '📁 ' + d); li.addEventListener('click', function () { browse(j.path.replace(/\/$/, '') + '/' + d); }); ul.appendChild(li); });
            body.appendChild(ul);
        }, function (e) { $('dialog-body').textContent = e.message; });
    }
    $('btn-browse').addEventListener('click', function () {
        openDialog('Choose the PDF folder', 'Use this folder'); browse($('folder-path').value.trim() || null);
    });
    $('dialog-ok').addEventListener('click', function () { dialog.hidden = true; markDirty(); loadFolder(browsePath); });

    // ---------- table toolbar ----------
    $('btn-add-row').addEventListener('click', function () {
        var used = {}; state.rows.forEach(function (r) { used[r.pc] = 1; });
        var n = 0; while (used[n] && n < 127) n++;
        var last = state.rows[state.rows.length - 1];
        state.rows.push(newRow({ pc: String(n), song: last ? last.song : (state.files && state.files[0] ? state.files[0].name : ''), page: '1' }));
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
    function hasDup() { var v = validate(); return state.rows.some(function (r) { return v[r.id].pcErr; }); }

    // ---------- projects ----------
    var nameEl = $('project-name');
    function projectName() { return nameEl.value.trim() || 'Untitled'; }
    function pdset() {
        return {
            version: 2, name: projectName(), folder: state.folder,
            rows: state.rows.map(function (r) { return { pc: toInt(r.pc), song: r.song, page: toInt(r.page) }; })
        };
    }
    function canSave() {
        var v = validate();
        if (!state.folder || state.folderError && !state.rows.length) { notice('Choose a PDF folder first.', 'error'); return false; }
        if (v.fatal) { notice('Fix the red rows first (duplicate or invalid numbers, or no song chosen).', 'error'); return false; }
        return true;
    }
    function saveToMac() {
        if (!canSave()) return Promise.resolve(false);
        var name = projectName();
        return api('/projects/' + encodeURIComponent(name), jsonOpts('PUT', pdset())).then(function (j) {
            savedName = name; dirty = false;
            var v = validate(), probs = state.rows.filter(function (r) { return v[r.id].level !== 'ok'; }).length;
            notice('Saved ' + j.file + (probs ? ' (' + probs + ' row' + (probs === 1 ? '' : 's') + ' have warnings)' : ''), probs ? '' : 'ok');
            return true;
        }, function (e) { notice('Save failed: ' + e.message, 'error'); return false; });
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
    function setProject(p, savedAs) {
        nameEl.value = p.name || 'Untitled';
        state.rows = (p.rows || []).map(function (r) { return newRow({ pc: String(r.pc), song: r.song, page: String(r.page) }); });
        savedName = savedAs || null; dirty = false;
        if (p.folder) { $('folder-path').value = p.folder; return loadFolder(p.folder, true); }
        state.folder = ''; state.files = null; rebuild(); return Promise.resolve();
    }
    function checkProject(p) {
        if (!p || p.version !== 2 || !Array.isArray(p.rows)) throw new Error('Not a version 2 .pdset file (older merge-style projects cannot be opened)');
        return p;
    }
    $('btn-new').addEventListener('click', function () {
        if (dirty && state.rows.length && !confirm('Discard unsaved changes?')) return;
        state.rows = []; nameEl.value = 'Untitled'; dirty = false; savedName = null; notice(''); rebuild();
    });
    $('btn-open-mac').addEventListener('click', function () {
        openDialog('Open project');
        api('/projects').then(function (j) {
            var body = $('dialog-body'); body.textContent = '';
            body.appendChild(el('div', 'hint', j.root));
            var ul = el('ul'); if (!j.projects.length) ul.appendChild(el('li', '', 'No saved projects yet'));
            j.projects.forEach(function (p) {
                var li = el('li'); li.appendChild(el('span', '', p.name + (p.name === j.active ? '  (active)' : '')));
                li.appendChild(el('span', 'hint', new Date(p.modified).toLocaleString()));
                li.addEventListener('click', function () {
                    if (dirty && state.rows.length && !confirm('Discard unsaved changes?')) return;
                    api('/projects/' + encodeURIComponent(p.name)).then(function (d) {
                        checkProject(d); dialog.hidden = true; notice('');
                        return setProject(d, p.name).then(function () { loadActive(); });
                    }).catch(function (e) { notice('Cannot open "' + p.name + '": ' + e.message, 'error'); dialog.hidden = true; });
                });
                ul.appendChild(li);
            });
            body.appendChild(ul);
        }, function (e) { $('dialog-body').textContent = e.message; });
    });
    $('btn-save-file').addEventListener('click', function () {
        if (!canSave()) return;
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(pdset(), null, 2)], { type: 'application/json' }));
        a.download = projectName() + '.pdset'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    $('btn-open-file').addEventListener('click', function () { $('file-pdset').click(); });
    $('file-pdset').addEventListener('change', function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
            try { var d = checkProject(JSON.parse(rd.result)); notice(''); setProject(d, null); markDirty(); }
            catch (err) { notice('Cannot open file: ' + err.message, 'error'); }
        };
        rd.readAsText(f);
    });

    // start
    loadActive();
    api('/projects').then(function (j) {
        if (j.active) return api('/projects/' + encodeURIComponent(j.active)).then(function (d) { return setProject(checkProject(d), j.active); });
    }).catch(function () {});
    rebuild();
    window.__composer = { state: state, validate: validate };
})();

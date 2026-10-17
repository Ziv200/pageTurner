// Pure helpers (no DOM) so they can be tested in Node.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ComposerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // "1-3,5" -> [0,1,2,4] (zero-based page indexes). Empty -> all pages.
    // Supports "4-" (to the end), "-3" (from the start). Throws Error with a readable message.
    function parseRange(text, pageCount) {
        const t = (text || '').trim();
        if (!t) return Array.from({ length: pageCount }, (_, i) => i);
        const out = [];
        for (const raw of t.split(/[,;\s]+/).filter(Boolean)) {
            const m = /^(\d*)(?:(-|–)(\d*))?$/.exec(raw);
            if (!m || (m[1] === '' && !m[2]) || (m[2] && m[1] === '' && m[3] === '')) {
                throw new Error('Cannot read "' + raw + '"');
            }
            let a, b;
            if (!m[2]) { a = b = parseInt(m[1], 10); }
            else {
                a = m[1] === '' ? 1 : parseInt(m[1], 10);
                b = m[3] === '' ? pageCount : parseInt(m[3], 10);
            }
            if (a < 1 || b < 1) throw new Error('Pages start at 1');
            if (a > pageCount || b > pageCount) throw new Error('File has only ' + pageCount + ' page' + (pageCount === 1 ? '' : 's'));
            if (a > b) throw new Error('"' + raw + '" goes backwards');
            for (let p = a; p <= b; p++) out.push(p - 1);
        }
        return out;
    }

    function newId() {
        let s = '';
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    function buildPdset(name, items, folder) {
        return {
            version: 1,
            app: 'pageTurner-composer',
            name: name,
            items: items.map(function (it) {
                return {
                    id: it.id,
                    fileName: it.fileName,
                    path: it.path || (folder ? folder + '/files/' + it.id + '.pdf' : null),
                    size: it.size,
                    lastModified: it.lastModified,
                    pageRange: it.pageRange || '',
                    stored: !!folder
                };
            }),
            order: items.map(function (it) { return it.id; })
        };
    }

    // Returns items sorted by "order"; throws on unusable data.
    function readPdset(data) {
        if (!data || typeof data !== 'object' || !Array.isArray(data.items)) throw new Error('Not a valid .pdset file');
        if (data.version !== 1) throw new Error('Unsupported .pdset version: ' + data.version);
        const byId = {};
        data.items.forEach(function (it) { byId[it.id] = it; });
        const order = Array.isArray(data.order) ? data.order : data.items.map(function (i) { return i.id; });
        const seen = {};
        const items = [];
        order.forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = 1; items.push(byId[id]); } });
        data.items.forEach(function (it) { if (!seen[it.id]) items.push(it); });
        return { name: typeof data.name === 'string' ? data.name : 'Untitled', items: items };
    }

    // Find the best waiting (missing) item for a dropped file: exact name+size first, then same name.
    function matchMissing(file, missingItems) {
        let exact = missingItems.find(function (m) { return m.fileName === file.name && m.size === file.size; });
        if (exact) return { item: exact, changed: false };
        let byName = missingItems.find(function (m) { return m.fileName === file.name; });
        if (byName) return { item: byName, changed: true };
        return null;
    }

    function safeFileBase(name) {
        const s = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
        return s || 'Untitled';
    }

    return { parseRange, newId, buildPdset, readPdset, matchMissing, safeFileBase };
});

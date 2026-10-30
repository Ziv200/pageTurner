// Builds "Sample Project.pdset" (container v3, same format Composer writes) with 3 demo songs.
const fs = require('fs'), path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
async function song(title, pages) {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.HelveticaBold); const g = await d.embedFont(StandardFonts.Helvetica);
    for (let p = 1; p <= pages; p++) {
        const pg = d.addPage([595, 842]);
        pg.drawText(title, { x: 60, y: 760, size: 34, font: f });
        pg.drawText('Page ' + p + ' of ' + pages, { x: 60, y: 720, size: 18, font: g, color: rgb(.4, .4, .4) });
        for (let s = 0; s < 8; s++) for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 60, y: 640 - s * 70 - l * 8 }, end: { x: 535, y: 640 - s * 70 - l * 8 }, thickness: 0.8 });
        pg.drawText('Demo page - replace with your own PDFs in Composer', { x: 60, y: 60, size: 12, font: g, color: rgb(.5, .5, .5) });
    }
    return Buffer.from(await d.save());
}
module.exports = (async () => {
    const songs = [['1 Sample Opener.pdf', 1], ['2 Sample Ballad.pdf', 2], ['3 Sample Finale.pdf', 1]];
    const bufs = []; for (const [n, p] of songs) bufs.push(await song(n.replace(/^\d+ |\.pdf$/g, ''), p));
    const header = { version: 3, name: 'Sample Project',
        rows: [{ pc: 1, song: songs[0][0], page: 1 }, { pc: 2, song: songs[1][0], page: 1 }, { pc: 3, song: songs[1][0], page: 2 }, { pc: 4, song: songs[2][0], page: 1 }],
        pdfs: songs.map(([n, p], i) => ({ name: n, size: bufs[i].length, pages: p })) };
    const hb = Buffer.from(JSON.stringify(header)); const len = Buffer.alloc(4); len.writeUInt32BE(hb.length);
    const dir = path.join(__dirname, '..', 'build-resources'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Sample Project.pdset'), Buffer.concat([Buffer.from('PDSET3\0\0', 'latin1'), len, hb, ...bufs]));
})();

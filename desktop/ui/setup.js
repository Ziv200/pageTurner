let dir = null, info = null;
const $ = id => document.getElementById(id);
async function load() {
    info = await window.pt.info();
    if (!dir) dir = info.settings.projectsDir; $('dir').textContent = dir;
    $('sample').parentElement.style.display = info.sampleAvailable ? '' : 'none';
    const m = info.midi || {}, sel = $('midi'), ports = m.availablePorts || [];
    sel.innerHTML = '';
    if (!ports.length) { sel.innerHTML = '<option>No MIDI inputs found</option>'; sel.disabled = true; $('midistate').innerHTML = '<span class="bad">Turn on the IAC Driver (above), then Refresh</span>'; }
    else {
        sel.disabled = false;
        if (!m.connectedPort) sel.append(new Option('— choose —', ''));
        ports.forEach(p => sel.append(new Option(p, p, false, p === m.connectedPort)));
        $('midistate').innerHTML = m.connectedPort ? '<span class="ok">✓ listening</span>' : '<span class="bad">not connected</span>';
    }
    $('lastpc').textContent = m.lastPc ? 'Last Program Change: Pgm ' + m.lastPc.pc + ' at ' + new Date(m.lastPc.at).toLocaleTimeString() + ' ✓ MIDI is arriving' : 'Last Program Change: none yet – send one from Ableton to test';
    const q = $('qr'); q.innerHTML = '';
    const urls = info.urls.filter(u => u.iface !== 'hostname');
    if (!urls.length) q.innerHTML = '<p class="bad">This Mac has no network address yet. Join Wi-Fi or turn on Internet Sharing for the iPad USB cable.</p>';
    urls.slice(0, 2).forEach(u => { const d = document.createElement('div'); d.innerHTML = '<img src="' + u.qr + '"><div class="url">' + u.url + '</div><div class="muted">' + u.iface + '</div>'; q.append(d); });
}
$('choose').onclick = async () => { const d = await window.pt.chooseFolder(); if (d) { dir = d; $('dir').textContent = d; } };
$('ams').onclick = () => window.pt.openAudioMidiSetup();
$('refresh').onclick = load;
$('midi').onchange = async e => { if (e.target.value) { await window.pt.setMidi(e.target.value); setTimeout(load, 500); } };
$('composer').onclick = () => window.pt.openUrl('http://localhost:' + info.port + '/composer/');
$('done').onclick = async () => {
    $('msg').textContent = 'Saving…';
    const r = await window.pt.finish({ projectsDir: dir, addSample: $('sample').checked && info.sampleAvailable });
    $('msg').textContent = r.sample === 'added' ? 'Sample Project added – activate it in Composer.' : 'Done.';
    setTimeout(() => window.close(), r.sample === 'added' ? 1800 : 400);
};
load(); setInterval(load, 3000);

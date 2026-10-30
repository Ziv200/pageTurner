window.pt.info().then(info => {
  const q = document.getElementById('qr'); const urls = info.urls.filter(u => u.iface !== 'hostname');
  if (!urls.length) { q.innerHTML = '<p class="bad">No network address yet – join Wi-Fi or enable Internet Sharing, then reopen this window.</p>'; return; }
  urls.forEach(u => { const d = document.createElement('div'); d.innerHTML = '<img src="' + u.qr + '"><div class="url">' + u.url + '</div><div class="muted">' + u.iface + '</div><br>'; q.append(d); });
});

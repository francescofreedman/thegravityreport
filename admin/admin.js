/* Admin queue UI. The key lives only in this tab (sessionStorage) and is sent as a header. */
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var KEY = '';
  try { KEY = sessionStorage.getItem('gr_admin') || ''; } catch(e){}
  function msg(t){ $('msg').textContent = t; }
  function api(path, body){
    var init = { headers: { 'x-admin-key': KEY } };
    if (body !== undefined){ init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/admin/' + path, init).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function el(tag, attrs, kids){
    var n = document.createElement(tag);
    for (var k in (attrs || {})){ if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function(c){ if (c) n.appendChild(c); });
    return n;
  }
  function when(s){ return s ? s.replace('T', ' ').slice(0, 16) + ' UTC' : 'not scheduled'; }
  function render(q){
    var s = $('status'); s.innerHTML = '';
    var live = Object.keys(q.platforms).filter(function(p){ return q.platforms[p].live; });
    s.appendChild(el('div', { 'class': 'banner' + (q.dry_run ? ' dry' : ''), text: q.dry_run
      ? 'DRY RUN is on: approved posts are simulated and logged, nothing is sent.'
      : 'LIVE for: ' + (live.join(', ') || 'no platform yet (no secrets set)') + '. Monthly caps: ' + Object.keys(q.platforms).map(function(p){ return p + ' ' + q.platforms[p].cap; }).join(', ') + '.' }));
    $('potd_on').checked = q.settings.potd_on === '1';
    $('potd_auto_approve').checked = q.settings.potd_auto_approve === '1';
    var box = $('rows'); box.innerHTML = '';
    if (!q.rows.length){ box.appendChild(el('p', { 'class': 'muted', text: 'Queue is empty. Import a kit below.' })); return; }
    q.rows.forEach(function(r){
      var p = JSON.parse(r.payload);
      var text = el('div', { 'class': 'q-text', text: (p.posts || [p.caption]).join('\n\n— next post —\n\n') });
      var img = (p.images && p.images[0] && p.images[0].path) || (p.image_urls && p.image_urls[0]);
      if (img) text.appendChild(el('img', { src: img.replace('https://thegravityreport.com', ''), alt: (p.images && p.images[0] && p.images[0].alt) || 'post image' }));
      var acts = el('div', { 'class': 'q-act' });
      function btn(label, cls, fn){ var b = el('button', { type: 'button', 'class': cls || '', text: label }); b.addEventListener('click', fn); acts.appendChild(b); }
      if (r.status === 'draft' || r.status === 'rejected') btn('Approve', 'go', function(){ act('approve', { id: r.id }); });
      if (r.status === 'draft' || r.status === 'approved') btn('Schedule…', '', function(){
        var v = prompt('Post at (UTC), e.g. 2026-10-21 16:00', (r.scheduled_at || '').replace('T', ' ').slice(0, 16));
        if (v) act('schedule', { id: r.id, scheduled_at: new Date(v.replace(' ', 'T') + ':00Z').toISOString() });
      });
      if (r.status === 'draft' || r.status === 'approved' || r.status === 'held') btn('Reject', '', function(){ act('reject', { id: r.id }); });
      if (r.status === 'failed' || r.status === 'held') btn('Retry', '', function(){ act('retry', { id: r.id }); });
      var meta = el('div', { 'class': 'q-meta' }, [el('b', { text: r.platform }), el('div', { text: r.kit_id }), el('div', { text: when(r.scheduled_at) }),
        el('span', { 'class': 'st st-' + r.status, text: r.status.toUpperCase() }), r.error ? el('div', { text: r.error }) : null]);
      box.appendChild(el('div', { 'class': 'q-row' }, [meta, text, acts]));
    });
  }
  function load(){
    if (!KEY) return;
    api('queue').then(function(q){ render(q); msg('Unlocked.'); }).catch(function(e){ msg('Error: ' + e.message); });
    api('kits').then(function(k){
      var ul = $('kitlist'); ul.innerHTML = '';
      (k.kits || []).forEach(function(kit){
        var b = el('button', { type: 'button', text: 'Import as drafts' });
        b.addEventListener('click', function(){ act('import', { kit_id: kit.id }); });
        ul.appendChild(el('li', {}, [el('span', { text: kit.id + ' — ' + kit.title }), b]));
      });
    }).catch(function(){});
  }
  function act(path, body){ api(path, body).then(function(j){ msg(path + ': ok' + (j.changed !== undefined ? ' (' + j.changed + ')' : '') + (j.added !== undefined ? ' (' + j.added + ' added)' : '')); load(); }).catch(function(e){ msg('Error: ' + e.message); }); }
  $('keyform').addEventListener('submit', function(e){ e.preventDefault(); KEY = $('key').value; try { sessionStorage.setItem('gr_admin', KEY); } catch(x){} load(); });
  $('lock').addEventListener('click', function(){ KEY = ''; try { sessionStorage.removeItem('gr_admin'); } catch(x){} $('rows').innerHTML = ''; msg('Locked.'); });
  $('week').addEventListener('click', function(){ if (confirm('Approve every draft scheduled in the next 7 days?')) act('approve-week', {}); });
  $('run').addEventListener('click', function(){ act('run-now', {}); });
  $('reload').addEventListener('click', load);
  ['potd_on', 'potd_auto_approve'].forEach(function(k){ $(k).addEventListener('change', function(){ act('settings', { key: k, value: $(k).checked ? '1' : '0' }); }); });
  load();
})();

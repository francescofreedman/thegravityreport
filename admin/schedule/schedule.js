/* Schedule preview: reads /social/schedule.json + each kit, shows each post as it will look on
   each platform. With the admin key: live status per post, and Stop / Bring back. */
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var KEY = ''; try { KEY = sessionStorage.getItem('gr_admin') || ''; } catch(e){}
  var NAMES = { x: 'X', bluesky: 'Bluesky', threads: 'Threads', instagram: 'Instagram' };
  var HANDLES = { x: '@GravityReportHQ', bluesky: '@thegravityreport.bsky.social', threads: '@thegravityreport', instagram: 'thegravityreport' };
  var AVATAR = '/social/brand/avatar-400.png';
  var KINDS = { player: 'Player of the day', article: 'Deep Dive', edition: 'Edition', team: 'The 644 on your team',
    ledger: 'Is the model winning?', archive: 'From the archive', pace: 'Beating the projection', best: 'Best games of the week',
    poll: 'Who\'s higher?' };
  function kindLabel(kit){ return kit ? (KINDS[kit.series || kit.kind] || kit.kind || '') : ''; }
  var SCHED = null, KITS = {}, QUEUE = null, FILTER = 'upcoming';

  function msg(t){ $('msg').textContent = t; }
  function el(tag, attrs, kids){
    var n = document.createElement(tag);
    for (var k in (attrs || {})){ if (k === 'text') n.textContent = attrs[k]; else if (k === 'cls') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function(c){ if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(path, body){
    var init = { headers: { 'x-admin-key': KEY } };
    if (body !== undefined){ init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/admin/' + path, init).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function abs(kit, p){ return /^(\/|https?:)/.test(p) ? p : '/social/kits/' + kit + '/' + p; }
  var ET = { timeZone: 'America/New_York' };
  function dayLabel(d){ return d.toLocaleDateString('en-US', Object.assign({ weekday: 'long', month: 'long', day: 'numeric' }, ET)); }
  function timeLabel(d){ return d.toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, ET)) + ' ET'; }

  function status(kit, platform, at){
    if (QUEUE){
      var row = QUEUE.rows.filter(function(r){ return r.kit_id === kit && r.platform === platform; })[0];
      var conn = QUEUE.platforms[platform] && QUEUE.platforms[platform].configured;
      if (row){
        if (row.status === 'posted') return { k: 'posted', t: 'Posted' };
        if (row.status === 'failed') return { k: 'failed', t: 'Failed: ' + (row.error || '') };
        if (row.status === 'cancelled') return { k: 'stopped', t: 'Stopped' };
        if (row.status === 'skipped') return { k: 'notconnected', t: 'Skipped: ' + NAMES[platform] + ' not connected' };
        if (row.status === 'simulated') return { k: 'simulated', t: 'Simulated (dry run)' };
        if (row.status === 'held') return { k: 'failed', t: 'Held: ' + (row.error || '') };
      }
      if (!conn && !QUEUE.dry_run) return { k: 'notconnected', t: NAMES[platform] + ' not connected yet' };
    }
    return { k: 'scheduled', t: at < Date.now() ? 'Due' : 'Scheduled' };
  }

  function threadBody(posts){
    var b = el('div', { cls: 'pv-body' });
    posts.forEach(function(p, i){ b.appendChild(i ? el('span', { cls: 'n', text: p }) : el('span', { text: p })); });
    return b;
  }

  function preview(row, kit){
    var pl = row.platform, kitId = row.kit, at = Date.parse(row.at);
    var st = status(kitId, pl, at);
    var card = kit.images && kit.images.card ? abs(kitId, kit.images.card) : null;
    var box = el('div', { cls: 'pv' + (st.k === 'stopped' ? ' stopped' : '') });
    box.appendChild(el('div', { cls: 'pv-top' }, [el('img', { src: AVATAR, alt: '' }),
      el('div', {}, [el('div', { cls: 'nm', text: 'The Gravity Report' }), el('div', { cls: 'hd', text: HANDLES[pl] })]),
      el('span', { cls: 'pl', text: NAMES[pl] })]));
    if (pl === 'x' || pl === 'bluesky'){
      var posts = pl === 'x' ? kit.x_thread : kit.bluesky_thread;
      box.appendChild(threadBody(posts.slice(0, 1)));
      if (card) box.appendChild(el('img', { cls: 'pv-img', src: card, alt: (kit.alt && (kit.alt[kit.images.card] || kit.alt.card)) || '' }));
      if (posts.length > 1){
        var d = el('details', { cls: 'more' }, [el('summary', { text: 'Thread: ' + (posts.length - 1) + ' more' })]);
        d.appendChild(threadBody([''].concat(posts.slice(1))));
        box.appendChild(d);
      }
    } else if (pl === 'threads'){
      box.appendChild(threadBody([kit.threads]));
      if (card) box.appendChild(el('img', { cls: 'pv-img', src: card, alt: '' }));
    } else {
      var imgs = ((kit.images && kit.images.carousel) || []).map(function(p){ return abs(kitId, p); });
      if (!imgs.length && card) imgs = [card];
      var car = el('div', { cls: 'car' });
      imgs.forEach(function(src){ car.appendChild(el('img', { src: src, alt: '' })); });
      box.appendChild(car);
      var cap = el('details', { cls: 'more' }, [el('summary', { text: 'Caption' })]);
      cap.appendChild(el('div', { cls: 'pv-body', text: kit.instagram_caption }));
      box.appendChild(cap);
    }
    var foot = el('div', { cls: 'pv-foot' }, [el('span', { cls: 'st st-' + st.k, text: st.t })]);
    if (QUEUE && (st.k === 'scheduled' || st.k === 'notconnected' || st.k === 'simulated')){
      var b = el('button', { type: 'button', text: 'Stop' });
      b.onclick = function(){ if (!confirm('Stop this ' + NAMES[pl] + ' post?')) return;
        api('cancel', { kit: kitId, platform: pl }).then(function(){ msg('Stopped.'); loadQueue(); }).catch(function(e){ msg('Error: ' + e.message); }); };
      foot.appendChild(b);
    }
    if (QUEUE && st.k === 'stopped'){
      var r = el('button', { type: 'button', text: 'Bring back' });
      r.onclick = function(){ api('restore', { kit: kitId, platform: pl }).then(function(){ msg('Back on the schedule.'); loadQueue(); }).catch(function(e){ msg('Error: ' + e.message); }); };
      foot.appendChild(r);
    }
    box.appendChild(foot);
    return box;
  }

  function render(){
    var box = $('days'); box.innerHTML = '';
    var now = Date.now();
    var rows = SCHED.posts.filter(function(r){
      if (FILTER === 'upcoming') return Date.parse(r.at) > now - 3600 * 1000;
      if (FILTER === 'all') return true;
      return r.platform === FILTER;
    }).sort(function(a, b){ return Date.parse(a.at) - Date.parse(b.at); });
    if (!rows.length){ box.appendChild(el('p', { cls: 'muted', text: 'Nothing scheduled.' })); return; }
    // group by day, then by (time, kit)
    var lastDay = null, dayBox = null, groups = {};
    rows.forEach(function(r){
      var d = new Date(r.at), dl = dayLabel(d), gk = r.at + '|' + r.kit;
      if (dl !== lastDay){ dayBox = el('section', { cls: 'day' }, [el('h2', { text: dl })]); box.appendChild(dayBox); lastDay = dl; }
      if (!groups[gk]){
        var kit = KITS[r.kit];
        var g = el('div', { cls: 'post' }, [el('div', { cls: 'post-head' }, [
          el('span', { cls: 't', text: timeLabel(d) }), el('span', { cls: 'k', text: kit ? kit.title : r.kit }),
          el('span', { cls: 'kind', text: kindLabel(kit) })]),
          el('div', { cls: 'grid' })]);
        groups[gk] = g; dayBox.appendChild(g);
      }
      if (KITS[r.kit]) groups[gk].querySelector('.grid').appendChild(preview(r, KITS[r.kit]));
    });
  }

  // automatic posts (player of the day) live only in the queue: show them like scheduled rows
  function addQueueOnly(q){
    SCHED.posts = SCHED.posts.filter(function(r){ return !r.auto; });
    var seen = {};
    SCHED.posts.forEach(function(r){ seen[r.kit + '|' + r.platform] = 1; });
    q.rows.forEach(function(r){
      if (seen[r.kit_id + '|' + r.platform] || !r.scheduled_at) return;
      var p = JSON.parse(r.payload), k = KITS[r.kit_id] || (KITS[r.kit_id] = { title: p.title || r.kit_id, kind: 'player', images: {}, alt: {} });
      if (r.platform === 'x') k.x_thread = p.posts;
      if (r.platform === 'bluesky') k.bluesky_thread = p.posts;
      if (r.platform === 'threads') k.threads = p.posts[0];
      if (r.platform === 'instagram'){ k.instagram_caption = p.caption; k.images.carousel = p.image_urls || []; }
      if (p.images && p.images[0]) k.images.card = p.images[0].path;
      if (p.title) k.title = p.title;
      SCHED.posts.push({ at: r.scheduled_at, platform: r.platform, kit: r.kit_id, auto: true });
    });
    Object.keys(KITS).forEach(function(id){ var k = KITS[id];
      k.x_thread = k.x_thread || k.bluesky_thread || [k.threads || ''];
      k.bluesky_thread = k.bluesky_thread || k.x_thread; k.threads = k.threads || k.x_thread[0];
      k.instagram_caption = k.instagram_caption || ''; k.images.carousel = k.images.carousel || []; });
  }

  function loadQueue(){
    if (!KEY){ QUEUE = null; render(); return Promise.resolve(); }
    return api('queue').then(function(q){
      QUEUE = q; addQueueOnly(q);
      var live = Object.keys(q.platforms).filter(function(p){ return q.platforms[p].live; }).map(function(p){ return NAMES[p]; });
      var off = Object.keys(q.platforms).filter(function(p){ return !q.platforms[p].configured; }).map(function(p){ return NAMES[p]; });
      $('status').innerHTML = '';
      $('status').appendChild(el('div', { cls: 'banner', text: q.dry_run ? 'DRY RUN is on: nothing is sent.' :
        'Posting live on: ' + (live.join(', ') || 'nothing yet') + (off.length ? '. Not connected yet: ' + off.join(', ') + ' (their posts are skipped).' : '.') }));
      msg(''); render();
    }).catch(function(e){ msg(e.message === 'unauthorized' ? 'That key didn’t match. Paste it again.' : 'Error: ' + e.message); QUEUE = null; render(); });
  }

  fetch('/social/schedule.json', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(s){
    SCHED = s;
    var ids = {}; s.posts.forEach(function(r){ ids[r.kit] = 1; });
    return Promise.all(Object.keys(ids).map(function(id){
      return fetch('/social/kits/' + id + '/kit.json').then(function(r){ return r.ok ? r.json() : null; }).then(function(k){ if (k) KITS[id] = k; });
    }));
  }).then(loadQueue).catch(function(e){ $('days').innerHTML = ''; msg('Could not load the schedule: ' + e.message); });

  $('keyform').addEventListener('submit', function(e){ e.preventDefault(); KEY = $('key').value.trim(); try { sessionStorage.setItem('gr_admin', KEY); } catch(x){} loadQueue(); });
  $('lock').addEventListener('click', function(){ KEY = ''; try { sessionStorage.removeItem('gr_admin'); } catch(x){} QUEUE = null; $('status').innerHTML = ''; msg('Locked.'); render(); });
  Array.prototype.forEach.call(document.querySelectorAll('#filters button'), function(b){
    b.addEventListener('click', function(){
      FILTER = b.getAttribute('data-f');
      Array.prototype.forEach.call(document.querySelectorAll('#filters button'), function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      render();
    });
  });
})();

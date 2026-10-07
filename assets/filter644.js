/* Filter for The 644 list and the players index. The list stays a list; this only hides rows. */
(function(){
  var list = document.getElementById('list644');
  if (!list) return;
  var items = Array.prototype.slice.call(list.children);
  var q = document.getElementById('f-q'), t = document.getElementById('f-t'),
      p = document.getElementById('f-p'), r = document.getElementById('f-r'),
      out = document.getElementById('f-count');
  function norm(s){ return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function apply(){
    var qs = norm(q && q.value), ts = t ? t.value : '', ps = p ? p.value : '', rk = r ? r.checked : false, n = 0;
    items.forEach(function(li){
      var ok = (!qs || norm(li.dataset.n).indexOf(qs) !== -1)
        && (!ts || li.dataset.t === ts)
        && (!ps || (li.dataset.p || '').indexOf(ps) !== -1)
        && (!rk || li.dataset.r === '1');
      li.hidden = !ok; if (ok) n++;
    });
    if (out) out.textContent = n === items.length ? n + ' players' : n + ' of ' + items.length + ' players';
  }
  [q, t, p, r].forEach(function(el){ if (el) el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', apply); });
  if (q && location.hash.indexOf('#q=') === 0){ q.value = decodeURIComponent(location.hash.slice(3)); apply(); }
})();

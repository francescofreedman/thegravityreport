/* Toggle between editions of The 30 inside an article. Without JS both tables stay visible. */
(function(){
  document.querySelectorAll('[data-editions]').forEach(function(box){
    var btns = box.querySelectorAll('[data-ed]'), panels = box.querySelectorAll('[data-panel]');
    function show(id){
      btns.forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.ed === id ? 'true' : 'false'); });
      panels.forEach(function(p){ p.hidden = p.dataset.panel !== id; });
    }
    btns.forEach(function(b){ b.addEventListener('click', function(){ show(b.dataset.ed); }); });
    show('oct');
  });
})();

/* Old inbox links (thegravityreport.com/#folder/message) -> their new homes.
   The original inbox itself is kept at /classic/. */
(function(){
  var h = (location.hash || '').replace(/^#/, '');
  if (!h) return;
  var parts = h.split('/'), folder = parts[0], msg = parts[1] || '';
  var MSG = {
    spec: '/model/', specdoc: '/notes/spec/', ed644: '/the644/', ed30: '/the644/#teams',
    ledger: '/ledger/', kawhi: '/notes/kawhi/', queta: '/notes/queta/', morant: '/notes/morant/',
    welcome: '/classic/#inbox/welcome', draft_duren: '/classic/#drafts/draft_duren',
    draft_no4: '/classic/#drafts/draft_no4', outbox_queta: '/ledger/#scheduled',
    outbox_the30: '/ledger/#scheduled', del_butler: '/corrections/#butler'
  };
  var FOLDER = {
    inbox: null, folders: null, drafts: '/classic/#drafts', outbox: '/ledger/#scheduled',
    deleted: '/corrections/', spec: '/model/', '644': '/the644/', ledger: '/ledger/', audit: '/ledger/#scheduled'
  };
  var to = null;
  if (msg && MSG[msg]) to = MSG[msg];
  else if (MSG[folder]) to = MSG[folder];
  else if (Object.prototype.hasOwnProperty.call(FOLDER, folder)) to = FOLDER[folder];
  if (to) location.replace(to);
})();

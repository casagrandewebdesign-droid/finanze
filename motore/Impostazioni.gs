/**
 * FINANZE APP — IMPOSTAZIONI CONDIVISE (file separato, va in fondo all'elenco, SOTTO "Esposizione")
 * Salva nel motore le impostazioni dell'app (per ora l'obiettivo di patrimonio),
 * così sono uguali su iPhone, iPad e qualsiasi altro dispositivo.
 * Azioni: "impostazioni" (legge tutto) e "salvaImpostazioni" (salva solo le chiavi inviate; null = cancella).
 * Non serve eseguire nulla: basta fare "Nuova versione" del deployment.
 */
(function () {
  if (typeof handle_ === 'function' && !handle_._imp) {
    const orig = handle_;
    handle_ = function (p) {
      if (p.action !== 'impostazioni' && p.action !== 'salvaImpostazioni') return orig(p);
      try {
        if (!p.token || p.token !== PROPS.getProperty('API_TOKEN')) return json_({ ok: false, error: 'Token non valido' });
        const d = p.data && typeof p.data === 'object' ? p.data : {};
        return json_({ ok: true, data: p.action === 'impostazioni' ? impostazioni_() : withLock_(() => salvaImpostazioni_(d)) });
      } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
    };
    ['_v2', '_v3', '_esp'].forEach(k => { if (orig[k]) handle_[k] = true; });
    handle_._imp = true;
  }
})();

function impostazioni_() {
  try { return JSON.parse(PROPS.getProperty('IMPOSTAZIONI_APP') || '{}'); } catch (e) { return {}; }
}
function salvaImpostazioni_(d) {
  const s = impostazioni_();
  Object.keys(d).forEach(k => { if (d[k] === null) delete s[k]; else s[k] = d[k]; });
  PROPS.setProperty('IMPOSTAZIONI_APP', JSON.stringify(s));
  return s;
}

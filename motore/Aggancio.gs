/**
 * FINANZE APP — AGGANCIO DELLE AZIONI (file separato, va SUBITO SOTTO Codice.gs)
 * ---------------------------------------------------------------------------
 * Un solo punto in cui le estensioni si collegano a handle_ di Codice.gs.
 * Ogni file registra le sue azioni con una riga:
 *     aggancia_({ nomeAzione: (d, p) => ... });
 *   d = p.data se è un oggetto, altrimenti tutta la richiesta p
 * Qui si controlla il token una volta sola e si risponde sempre nello stesso formato JSON.
 * Le azioni non registrate passano a Codice.gs come prima.
 */
var AZIONI_ = {};

function aggancia_(azioni) {
  Object.keys(azioni).forEach(function (k) { AZIONI_[k] = azioni[k]; });
  if (typeof handle_ !== 'function' || handle_._azioni) return;
  const orig = handle_;
  handle_ = function (p) {
    const fn = p && AZIONI_[p.action];
    if (!fn) return orig(p);
    try {
      if (!p.token || p.token !== PROPS.getProperty('API_TOKEN')) return json_({ ok: false, error: 'Token non valido' });
      const d = p.data && typeof p.data === 'object' ? p.data : p;
      return json_({ ok: true, data: fn(d, p) });
    } catch (err) {
      return json_({ ok: false, error: String(err && err.message || err) });
    }
  };
  handle_._azioni = true;
}

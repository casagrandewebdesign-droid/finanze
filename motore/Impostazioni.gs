/**
 * FINANZE APP — IMPOSTAZIONI CONDIVISE (file separato, va in fondo all'elenco, SOTTO "Esposizione")
 * Salva nel motore le impostazioni dell'app (per ora l'obiettivo di patrimonio),
 * così sono uguali su iPhone, iPad e qualsiasi altro dispositivo.
 * Azioni: "impostazioni" (legge tutto) e "salvaImpostazioni" (salva solo le chiavi inviate; null = cancella).
 * Si pubblica da solo con il deploy automatico (vedi DEPLOY.md).
 */
aggancia_({
  impostazioni: () => impostazioni_(),
  salvaImpostazioni: (d, p) => withLock_(() => salvaImpostazioni_(p.data && typeof p.data === 'object' ? p.data : {})),
});

function impostazioni_() {
  try { return JSON.parse(PROPS.getProperty('IMPOSTAZIONI_APP') || '{}'); } catch (e) { return {}; }
}
function salvaImpostazioni_(d) {
  const s = impostazioni_();
  Object.keys(d).forEach(k => { if (d[k] === null) delete s[k]; else s[k] = d[k]; });
  PROPS.setProperty('IMPOSTAZIONI_APP', JSON.stringify(s));
  return s;
}

/**
 * FINANZE APP — ESPOSIZIONE AUTOMATICA PER PAESE E SETTORE (file separato, va SOTTO "Storico")
 * ---------------------------------------------------------------------------
 * Per ogni investimento con ISIN legge da internet la ripartizione per paese e per settore
 * (Financial Times, poi justETF) e la scrive nelle colonne "Paesi auto" e "Settori auto".
 * Le colonne "Paesi" e "Settori" restano tue: se le compili dall'app, valgono quelle.
 * Ogni settimana aggiorna i titoli con dati più vecchi di 30 giorni (o senza dati).
 *
 * Da eseguire UNA volta dall'editor: attivaEsposizione  (crea il timer e fa il primo giro)
 * Per provare senza scrivere nulla: testEsposizione
 */

const ESP_COLS = ['Paesi auto', 'Settori auto', 'Esposizione fonte'];

// ============ aggancio: azione "aggiornaEsposizione" per l'app ============
(function () {
  if (typeof handle_ === 'function' && !handle_._esp) {
    const orig = handle_;
    handle_ = function (p) {
      if (p.action !== 'aggiornaEsposizione') return orig(p);
      try {
        if (!p.token || p.token !== PROPS.getProperty('API_TOKEN')) return json_({ ok: false, error: 'Token non valido' });
        const d = p.data && typeof p.data === 'object' ? p.data : p;
        return json_({ ok: true, data: withLock_(() => aggiornaEsposizione_(d.nome, true)) });
      } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
    };
    ['_v2', '_v3'].forEach(k => { if (orig[k]) handle_[k] = true; });
    handle_._esp = true;
  }
})();

// ============ nomi in italiano ============
const ESP_NOMI = {
  'united states': 'USA', 'stati uniti': 'USA', 'usa': 'USA', 'us': 'USA', 'united states of america': 'USA',
  'united kingdom': 'Regno Unito', 'uk': 'Regno Unito', 'great britain': 'Regno Unito', 'japan': 'Giappone', 'canada': 'Canada',
  'france': 'Francia', 'germany': 'Germania', 'switzerland': 'Svizzera', 'netherlands': 'Paesi Bassi', 'italy': 'Italia',
  'spain': 'Spagna', 'china': 'Cina', 'india': 'India', 'taiwan': 'Taiwan', 'australia': 'Australia', 'sweden': 'Svezia',
  'denmark': 'Danimarca', 'ireland': 'Irlanda', 'korea': 'Corea del Sud', 'south korea': 'Corea del Sud', 'hong kong': 'Hong Kong',
  'brazil': 'Brasile', 'belgium': 'Belgio', 'finland': 'Finlandia', 'norway': 'Norvegia', 'austria': 'Austria', 'portugal': 'Portogallo',
  'singapore': 'Singapore', 'mexico': 'Messico', 'luxembourg': 'Lussemburgo', 'israel': 'Israele', 'south africa': 'Sudafrica',
  // settori
  'technology': 'Tecnologia', 'information technology': 'Tecnologia', 'tecnologia': 'Tecnologia', 'tecnologia dell\'informazione': 'Tecnologia', 'it/tecnologia': 'Tecnologia',
  'financial services': 'Finanza', 'financials': 'Finanza', 'finance': 'Finanza', 'servizi finanziari': 'Finanza', 'finanza': 'Finanza', 'finanziari': 'Finanza',
  'healthcare': 'Salute', 'health care': 'Salute', 'sanità': 'Salute', 'salute': 'Salute', 'assistenza sanitaria': 'Salute',
  'industrials': 'Industria', 'industria': 'Industria', 'industriali': 'Industria', 'beni industriali': 'Industria',
  'consumer cyclical': 'Beni voluttuari', 'consumer discretionary': 'Beni voluttuari', 'beni voluttuari': 'Beni voluttuari', 'beni di consumo ciclici': 'Beni voluttuari', 'consumi discrezionali': 'Beni voluttuari',
  'consumer defensive': 'Beni di consumo', 'consumer staples': 'Beni di consumo', 'beni di consumo': 'Beni di consumo', 'beni di prima necessità': 'Beni di consumo', 'beni di consumo non ciclici': 'Beni di consumo',
  'communication services': 'Comunicazioni', 'telecommunications': 'Comunicazioni', 'telecommunication services': 'Comunicazioni', 'telecomunicazioni': 'Comunicazioni', 'servizi di comunicazione': 'Comunicazioni', 'comunicazioni': 'Comunicazioni',
  'energy': 'Energia', 'energia': 'Energia', 'basic materials': 'Materiali', 'materials': 'Materiali', 'materiali': 'Materiali', 'materie prime': 'Materiali',
  'utilities': 'Utility', 'servizi di pubblica utilità': 'Utility', 'servizi pubblici': 'Utility', 'utility': 'Utility',
  'real estate': 'Immobiliare', 'immobiliare': 'Immobiliare', 'immobili': 'Immobiliare',
  'other': 'Altri', 'others': 'Altri', 'altro': 'Altri', 'altri': 'Altri', 'non classificato': 'Altri', 'not classified': 'Altri',
};
function espNome_(t) {
  const k = String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  return ESP_NOMI[k] || String(t).trim();
}

// ============ lettura delle tabelle ============
function testo_(h) {
  return String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'')
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Cerca nella pagina i blocchi con un titolo che parla di paesi/regioni o di settori
 * e ne legge le righe "nome … 12,34%". Restituisce {Paesi:{…}, Settori:{…}}.
 */
function leggiTabelle_(html) {
  const out = {};
  const re = /<(h[1-6]|caption|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const tit = []; let m;
  while ((m = re.exec(html))) tit.push({ pos: m.index, fine: re.lastIndex, t: testo_(m[2]) });
  tit.forEach((h, k) => {
    let tipo = null;
    if (/countr|region|paes|geograf|nazion/i.test(h.t)) tipo = 'Paesi';
    else if (/sector|settor/i.test(h.t)) tipo = 'Settori';
    if (!tipo || out[tipo] || h.t.length > 60) return;
    // il blocco va da questo titolo al prossimo titolo "vero" (non una cella th della stessa tabella)
    let end = html.length;
    for (let j = k + 1; j < tit.length; j++) if (/^<h/i.test(html.slice(tit[j].pos, tit[j].pos + 2))) { end = tit[j].pos; break; }
    const blocco = html.slice(h.fine, Math.min(end, h.fine + 40000));
    const righe = blocco.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    const o = {};
    righe.forEach(r => {
      const celle = (r.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map(testo_);
      if (celle.length < 2) return;
      const nome = celle[0];
      if (!nome || /total|totale|^fund$|^name$|^nome$/i.test(nome) || /\d+[.,]?\d*\s*%/.test(nome)) return;
      const c = celle.slice(1).find(x => /-?\d+(?:[.,]\d+)?\s*%/.test(x));
      if (!c) return;
      let n = c.match(/-?\d+(?:[.,]\d+)?/)[0];
      n = /,\d{1,2}$/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
      const v = parseFloat(n);
      if (!(v > 0) || v > 100) return;
      const k2 = espNome_(nome);
      o[k2] = (o[k2] || 0) + v;
    });
    const tot = Object.keys(o).reduce((s, x) => s + o[x], 0);
    if (Object.keys(o).length && tot > 20 && tot < 101) out[tipo] = o;
  });
  return out;
}
function fmtEsp_(o) {
  return Object.keys(o).sort((a, b) => (a === 'Altri') - (b === 'Altri') || o[b] - o[a])
    .map(k => k + ' ' + String(Math.round(o[k] * 10) / 10).replace('.', ',')).join(', ');
}

// ============ fonti ============
/** Financial Times: prima prova come ETF (simbolo trovato con la ricerca), poi come fondo per ISIN. */
function espFT_(isin) {
  const pagine = [];
  try {
    const j = JSON.parse(scarica_('https://markets.ft.com/data/searchapi/searchsecurities?query=' + isin));
    const lista = (j.data && j.data.security) || [];
    lista.slice(0, 3).forEach(s => {
      if (!s.symbol) return;
      const tipo = /etf/i.test(s.assetClass || '') ? 'etfs' : 'funds';
      pagine.push('https://markets.ft.com/data/' + tipo + '/tearsheet/holdings?s=' + encodeURIComponent(s.symbol));
    });
  } catch (e) { }
  ['EUR', 'USD', 'GBP'].forEach(v => pagine.push('https://markets.ft.com/data/funds/tearsheet/holdings?s=' + isin + ':' + v));
  for (const u of pagine) {
    let html; try { html = scarica_(u); } catch (e) { continue; }
    const t = leggiTabelle_(html);
    if (t.Paesi || t.Settori) return { ...t, fonte: 'FT' };
  }
  return null;
}
/** justETF (solo ETF): pagina del profilo in italiano. */
function espJustEtf_(isin) {
  let html; try { html = scarica_('https://www.justetf.com/it/etf-profile.html?isin=' + isin); } catch (e) { return null; }
  const t = leggiTabelle_(html);
  return t.Paesi || t.Settori ? { ...t, fonte: 'justETF' } : null;
}
function esposizioneDa_(isin) {
  const a = espFT_(isin), b = (!a || !a.Paesi || !a.Settori) ? espJustEtf_(isin) : null;
  if (!a && !b) return null;
  const r = { Paesi: (a && a.Paesi) || (b && b.Paesi) || null, Settori: (a && a.Settori) || (b && b.Settori) || null };
  r.fonte = [a && (a.Paesi || a.Settori) ? 'FT' : '', b ? 'justETF' : ''].filter(Boolean).join(' + ');
  return r;
}

// ============ aggiornamento ============
/** Aggiorna tutti i titoli con ISIN (o solo "nome"). forza=false salta quelli aggiornati da meno di 30 giorni. */
function aggiornaEsposizione_(nome, forza) {
  ESP_COLS.forEach(colonna_);
  delete _mem['r_' + SHEETS.INV];
  const esiti = [], soglia = Date.now() - 30 * 864e5;
  rows_(SHEETS.INV).forEach(r => {
    if (nome && r['Nome'] !== nome) return;
    const cod = String(r[COL_COD] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cod)) return;
    const dt = (String(r['Esposizione fonte'] || '').match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!forza && dt && new Date(dt).getTime() > soglia) return;
    try {
      const e = esposizioneDa_(cod);
      if (!e || (!e.Paesi && !e.Settori)) throw new Error('nessun dato trovato');
      if (e.Paesi) setInv_(r, 'Paesi auto', fmtEsp_(e.Paesi));
      if (e.Settori) setInv_(r, 'Settori auto', fmtEsp_(e.Settori));
      setInv_(r, 'Esposizione fonte', e.fonte + ' ' + ymd_(new Date()));
      esiti.push({ nome: r['Nome'], ok: true, paesi: e.Paesi ? fmtEsp_(e.Paesi) : '', settori: e.Settori ? fmtEsp_(e.Settori) : '', fonte: e.fonte });
    } catch (err) {
      const msg = String(err.message || err).slice(0, 100);
      setInv_(r, 'Esposizione fonte', '⚠ ' + msg + ' ' + ymd_(new Date()));
      esiti.push({ nome: r['Nome'], ok: false, errore: msg });
    }
  });
  return esiti;
}

/** Eseguita dal timer: una volta a settimana. */
function aggiornaEsposizioneAuto() { withLock_(() => aggiornaEsposizione_(null, false)); }

/** ESEGUI UNA VOLTA: crea il timer settimanale e fa subito il primo aggiornamento. */
function attivaEsposizione() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'aggiornaEsposizioneAuto').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('aggiornaEsposizioneAuto').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  const esiti = withLock_(() => aggiornaEsposizione_(null, true));
  console.log('Esposizione automatica attiva (ogni domenica mattina).');
  console.log(JSON.stringify(esiti, null, 2));
}
function disattivaEsposizione() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'aggiornaEsposizioneAuto').forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Esposizione automatica disattivata');
}

/** Prova: mostra cosa trova per ogni ISIN, senza scrivere nel foglio. */
function testEsposizione() {
  rows_(SHEETS.INV).forEach(r => {
    const cod = String(r[COL_COD] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cod)) { console.log(r['Nome'] + ': nessun ISIN'); return; }
    const ft = espFT_(cod), je = espJustEtf_(cod);
    console.log(r['Nome'] + ' (' + cod + ')\n  FT → ' + (ft ? JSON.stringify({ paesi: ft.Paesi && fmtEsp_(ft.Paesi), settori: ft.Settori && fmtEsp_(ft.Settori) }) : 'niente')
      + '\n  justETF → ' + (je ? JSON.stringify({ paesi: je.Paesi && fmtEsp_(je.Paesi), settori: je.Settori && fmtEsp_(je.Settori) }) : 'niente'));
  });
}

/** Diagnostica: mostra cosa rispondono le pagine per un ISIN (titoli trovati), senza scrivere nulla. */
function debugEsposizione() {
  const isin = 'LU0408877842';
  const vedi = (u) => {
    try {
      const r = UrlFetchApp.fetch(u, { headers: UA_, muteHttpExceptions: true, followRedirects: true });
      const h = r.getContentText();
      const tit = (h.match(/<(h[1-6]|caption|th)\b[^>]*>[\s\S]*?<\/\1>/gi) || []).map(testo_).filter(Boolean).slice(0, 40);
      console.log(u + '\n  codice ' + r.getResponseCode() + ' · ' + h.length + ' caratteri · title: ' + testo_((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
        + '\n  titoli: ' + JSON.stringify(tit)
        + '\n  "%" trovati: ' + (h.match(/\d+[.,]\d+\s*%/g) || []).slice(0, 15).join(' '));
    } catch (e) { console.log(u + ' → ERRORE ' + e.message); }
  };
  try { console.log('Ricerca FT: ' + scarica_('https://markets.ft.com/data/searchapi/searchsecurities?query=' + isin).slice(0, 600)); }
  catch (e) { console.log('Ricerca FT → ERRORE ' + e.message); }
  vedi('https://markets.ft.com/data/funds/tearsheet/holdings?s=' + isin + ':EUR');
  vedi('https://markets.ft.com/data/funds/tearsheet/summary?s=' + isin + ':EUR');
}

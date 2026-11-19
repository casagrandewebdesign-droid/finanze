/**
 * FINANZE APP — ESPOSIZIONE AUTOMATICA PER PAESE E SETTORE (file separato, va SOTTO "Storico")
 * ---------------------------------------------------------------------------
 * Per ogni investimento con ISIN legge da internet la ripartizione per paese e per settore
 * (Financial Times, poi justETF, poi finanzen.net) e la scrive nelle colonne "Paesi auto" e "Settori auto".
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
  'supranational': 'Sovranazionali', 'supranationals': 'Sovranazionali', 'supranationale': 'Sovranazionali', 'sovranazionali': 'Sovranazionali',
  'poland': 'Polonia', 'polen': 'Polonia', 'hungary': 'Ungheria', 'lithuania': 'Lituania', 'latvia': 'Lettonia', 'bulgaria': 'Bulgaria', 'greece': 'Grecia',
  'slovenia': 'Slovenia', 'slovakia': 'Slovacchia', 'estonia': 'Estonia', 'croatia': 'Croazia', 'romania': 'Romania', 'czech republic': 'Repubblica Ceca',
  'deutschland': 'Germania', 'italien': 'Italia', 'spanien': 'Spagna', 'frankreich': 'Francia', 'vereinigte staaten': 'USA', 'großbritannien': 'Regno Unito',
  'niederlande': 'Paesi Bassi', 'belgien': 'Belgio', 'österreich': 'Austria', 'schweiz': 'Svizzera',
  'singapore': 'Singapore', 'mexico': 'Messico', 'luxembourg': 'Lussemburgo', 'israel': 'Israele', 'south africa': 'Sudafrica',
  // settori
  'technology': 'Tecnologia', 'informatica': 'Tecnologia', 'it': 'Tecnologia', 'information technology': 'Tecnologia', 'tecnologia': 'Tecnologia', 'tecnologia dell\'informazione': 'Tecnologia', 'it/tecnologia': 'Tecnologia',
  'financial services': 'Finanza', 'financials': 'Finanza', 'finance': 'Finanza', 'servizi finanziari': 'Finanza', 'finanza': 'Finanza', 'finanziari': 'Finanza',
  'healthcare': 'Salute', 'health care': 'Salute', 'sanità': 'Salute', 'salute': 'Salute', 'assistenza sanitaria': 'Salute',
  'industrials': 'Industria', 'industria': 'Industria', 'industriali': 'Industria', 'beni industriali': 'Industria',
  'consumer cyclical': 'Beni voluttuari', 'beni di consumo voluttuari': 'Beni voluttuari', 'beni di consumo discrezionali': 'Beni voluttuari', 'consumer discretionary': 'Beni voluttuari', 'beni voluttuari': 'Beni voluttuari', 'beni di consumo ciclici': 'Beni voluttuari', 'consumi discrezionali': 'Beni voluttuari',
  'consumer defensive': 'Beni di consumo', 'consumer staples': 'Beni di consumo', 'beni di consumo': 'Beni di consumo', 'beni di prima necessità': 'Beni di consumo', 'beni di consumo non ciclici': 'Beni di consumo',
  'communication services': 'Comunicazioni', 'telecomunicazione': 'Comunicazioni', 'servizi di telecomunicazione': 'Comunicazioni', 'telecommunications': 'Comunicazioni', 'telecommunication services': 'Comunicazioni', 'telecomunicazioni': 'Comunicazioni', 'servizi di comunicazione': 'Comunicazioni', 'comunicazioni': 'Comunicazioni',
  'energy': 'Energia', 'energia': 'Energia', 'basic materials': 'Materiali', 'materials': 'Materiali', 'materiali': 'Materiali', 'materie prime': 'Materiali',
  'utilities': 'Utility', 'servizi di pubblica utilità': 'Utility', 'servizi pubblici': 'Utility', 'utility': 'Utility',
  'real estate': 'Immobiliare', 'immobiliare': 'Immobiliare', 'immobili': 'Immobiliare',
  'other': 'Altri', 'others': 'Altri', 'sonstige': 'Altri', 'andere': 'Altri', 'cash': 'Liquidità', 'liquidità': 'Liquidità', 'altro': 'Altri', 'altri': 'Altri', 'non classificato': 'Altri', 'not classified': 'Altri',
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
    if (/countr|region|paes|geograf|nazion|länder|laender/i.test(h.t)) tipo = 'Paesi';
    else if (/sector|settor|branche/i.test(h.t)) tipo = 'Settori';
    if (!tipo || out[tipo] || h.t.length > 60) return;
    // il blocco va da questo titolo al prossimo titolo "vero" (non una cella th della stessa tabella)
    let end = html.length;
    for (let j = k + 1; j < tit.length; j++) if (/^<h/i.test(html.slice(tit[j].pos, tit[j].pos + 2))) { end = tit[j].pos; break; }
    const blocco = html.slice(h.fine, Math.min(end, h.fine + 40000));
    const o = righeTabella_(blocco);
    const tot = Object.keys(o).reduce((s, x) => s + o[x], 0);
    if (Object.keys(o).length && tot > 20 && tot < 101) out[tipo] = o;
  });
  return out;
}
/** Legge le righe "nome | 12,34%" di un pezzo di HTML. */
function righeTabella_(blocco) {
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
    return o;
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
  // per ogni simbolo: "holdings" ha i settori, "summary" ha le regioni (Top 5 regions)
  const out = {};
  for (const u of pagine) {
    for (const pag of [u, u.replace('/holdings?', '/summary?')]) {
      if (out.Paesi && out.Settori) break;
      let html; try { html = scarica_(pag); } catch (e) { continue; }
      const t = leggiTabelle_(html);
      if (t.Paesi && !out.Paesi) out.Paesi = t.Paesi;
      if (t.Settori && !out.Settori) out.Settori = t.Settori;
    }
    if (out.Paesi || out.Settori) return { ...out, fonte: 'FT' };
  }
  return null;
}
/** justETF (solo ETF): pagina del profilo in italiano. */
function espJustEtf_(isin) {
  let html; try { html = scarica_('https://www.justetf.com/it/etf-profile.html?isin=' + isin); } catch (e) { return null; }
  const t = leggiTabelle_(html);
  return t.Paesi || t.Settori ? { ...t, fonte: 'justETF' } : null;
}
/** finanzen.net: trova la pagina del titolo dalla ricerca per ISIN, poi legge le pagine "laender" e "branchen". */
function finanzenUrl_(isin) {
  const r = UrlFetchApp.fetch('https://www.finanzen.net/suchergebnis.asp?_search=' + isin, { headers: UA_, muteHttpExceptions: true, followRedirects: false });
  const re = new RegExp('(?:https://www\\.finanzen\\.net)?/(fonds|etf)/([a-z0-9-]*' + isin.toLowerCase() + ')', 'i');
  const loc = r.getHeaders()['Location'] || r.getHeaders()['location'] || '';
  let m = String(loc).match(re) || r.getContentText().match(re);
  if (!m && /^3/.test(String(r.getResponseCode())) && loc) {
    const r2 = UrlFetchApp.fetch(loc.indexOf('http') === 0 ? loc : 'https://www.finanzen.net' + loc, { headers: UA_, muteHttpExceptions: true, followRedirects: true });
    m = r2.getContentText().match(re);
  }
  return m ? { tipo: m[1].toLowerCase(), slug: m[2] } : null;
}
function espFinanzen_(isin) {
  let u; try { u = finanzenUrl_(isin); } catch (e) { return null; }
  if (!u) return null;
  const out = {};
  [['Paesi', 'laender'], ['Settori', 'branchen']].forEach(([k, pag]) => {
    let html; try { html = scarica_('https://www.finanzen.net/' + u.tipo + '/' + pag + '/' + u.slug); } catch (e) { return; }
    let o = leggiTabelle_(html)[k];
    if (!o) { // ripiego: la prima tabella della pagina che somma circa 100
      for (const t of (html.match(/<table\b[\s\S]*?<\/table>/gi) || [])) {
        const x = righeTabella_(t), tot = Object.keys(x).reduce((s, y) => s + x[y], 0);
        if (Object.keys(x).length > 1 && tot > 80 && tot < 101) { o = x; break; }
      }
    }
    if (o) out[k] = o;
  });
  return out.Paesi || out.Settori ? { ...out, fonte: 'finanzen.net' } : null;
}
function esposizioneDa_(isin) {
  const fonti = [espFT_, espJustEtf_, espFinanzen_], r = { Paesi: null, Settori: null }, usate = [];
  for (const f of fonti) {
    if (r.Paesi && r.Settori) break;
    const x = f(isin); if (!x) continue;
    let usata = false;
    if (!r.Paesi && x.Paesi) { r.Paesi = x.Paesi; usata = true; }
    if (!r.Settori && x.Settori) { r.Settori = x.Settori; usata = true; }
    if (usata) usate.push(x.fonte);
  }
  if (!r.Paesi && !r.Settori) return null;
  r.fonte = usate.join(' + ');
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
  const f = x => x ? JSON.stringify({ paesi: x.Paesi && fmtEsp_(x.Paesi), settori: x.Settori && fmtEsp_(x.Settori) }) : 'niente';
  rows_(SHEETS.INV).forEach(r => {
    const cod = String(r[COL_COD] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cod)) { console.log(r['Nome'] + ': nessun ISIN'); return; }
    console.log(r['Nome'] + ' (' + cod + ')\n  FT → ' + f(espFT_(cod)) + '\n  justETF → ' + f(espJustEtf_(cod))
      + '\n  finanzen.net → ' + f(espFinanzen_(cod)) + '\n  RISULTATO → ' + f(esposizioneDa_(cod)));
  });
}

/** Diagnostica finanzen.net per un ISIN, senza scrivere nulla. */
function debugEsposizione() {
  const isin = 'LU0408877842';
  const r = UrlFetchApp.fetch('https://www.finanzen.net/suchergebnis.asp?_search=' + isin, { headers: UA_, muteHttpExceptions: true, followRedirects: false });
  const h = r.getContentText();
  console.log('Ricerca: codice ' + r.getResponseCode() + ' · Location: ' + (r.getHeaders()['Location'] || r.getHeaders()['location'] || '-') + ' · ' + h.length + ' caratteri');
  console.log('Link trovati: ' + JSON.stringify((h.match(/\/(fonds|etf)\/[a-z0-9\/-]+/gi) || []).slice(0, 15)));
  let u; try { u = finanzenUrl_(isin); } catch (e) { console.log('finanzenUrl_ → ERRORE ' + e.message); }
  console.log('Pagina: ' + JSON.stringify(u || null));
  if (u) ['laender', 'branchen'].forEach(p => {
    const url = 'https://www.finanzen.net/' + u.tipo + '/' + p + '/' + u.slug;
    try {
      const x = UrlFetchApp.fetch(url, { headers: UA_, muteHttpExceptions: true, followRedirects: true }), t = x.getContentText();
      const i = t.search(/Ländern|Branchen|Anteil/);
      console.log(url + '\n  codice ' + x.getResponseCode() + ' · ' + t.length + ' caratteri\n  pezzo: ' + (i < 0 ? '-' : t.slice(i, i + 1500)));
    } catch (e) { console.log(url + ' → ERRORE ' + e.message); }
  });
  const e = espFinanzen_(isin);
  console.log('RISULTATO finanzen.net → ' + (e ? JSON.stringify({ paesi: e.Paesi && fmtEsp_(e.Paesi), settori: e.Settori && fmtEsp_(e.Settori) }) : 'niente'));
}

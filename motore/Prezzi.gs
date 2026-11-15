/**
 * FINANZE APP — estensione del motore: PREZZI AUTOMATICI, PAC e TIPO DI TITOLO
 * ---------------------------------------------------------------------------
 * File separato: si aggancia a Codice.gs senza modificarlo.
 * Deve stare SOTTO Codice.gs nell'elenco dei file dell'editor.
 *
 * Cosa aggiunge:
 *   - prezzi aggiornati da internet per gli investimenti che hanno ISIN o ticker
 *     nella colonna "Codice (ISIN/ticker)" (Yahoo Finance, poi Financial Times)
 *   - tab "Acquisti": ogni acquisto (anche le rate di un PAC) con data, importo,
 *     prezzo e quote → quote totali, versato, prezzo medio e rendimento annualizzato
 *   - colonna "Classe" (Misto azioni/obbligazioni/monetario, es. "Misto 29,99/70,01/0")
 *   - colonna "Gruppo": "Previdenza" per i fondi pensione, tenuti separati dagli altri investimenti
 *   - l'app riceve tutte le colonne del foglio (campo "campi") e può scriverne di nuove (campo "campi"
 *     in updateInvestimento): le prossime funzioni non richiederanno di toccare di nuovo il motore
 *
 * Da eseguire UNA volta dall'editor: attivaPrezzi  (chiede l'autorizzazione e crea il timer)
 * Per provare senza scrivere nulla: testPrezzi
 */

const INV_EXTRA = ['Classe', 'Fonte prezzo', 'Data prezzo', 'Gruppo'];
const ACQ = 'Acquisti';
const ACQ_HEAD = ['ID', 'Data', 'Investimento', 'Importo', 'Prezzo', 'Quote', 'Note', 'Creato'];
const COL_COD = 'Codice (ISIN/ticker)';

// ============ aggancio a Codice.gs ============
(function () {
  if (typeof handle_ === 'function' && !handle_._v2) {
    const orig = handle_;
    handle_ = function (p) {
      const extra = {
        aggiornaPrezzi: d => withLock_(() => aggiornaPrezzi_(d.nome)),
        addAcquisto: d => withLock_(() => addAcquisto_(d)),
        deleteAcquisto: d => withLock_(() => deleteAcquisto_(d.id)),
        addInvestimento: d => withLock_(() => addInvestimento_(d)),
        deleteInvestimento: d => withLock_(() => deleteInvestimento_(d.nome)),
      };
      if (!extra[p.action]) return orig(p);
      try {
        if (!p.token || p.token !== PROPS.getProperty('API_TOKEN')) return json_({ ok: false, error: 'Token non valido' });
        const d = p.data && typeof p.data === 'object' ? p.data : p;
        return json_({ ok: true, data: extra[p.action](d) });
      } catch (err) {
        return json_({ ok: false, error: String(err && err.message || err) });
      }
    };
    handle_._v2 = true;
  }
  if (typeof getDashboard_ === 'function' && !getDashboard_._v2) {
    const orig = getDashboard_;
    getDashboard_ = function (m) { const r = orig(m); if (!r._v2) arricchisci_(r); return r; };
    getDashboard_._v2 = true;
  }
  if (typeof updateInvestimento_ === 'function' && !updateInvestimento_._v2) {
    const orig = updateInvestimento_;
    updateInvestimento_ = function (d) {
      schema_();
      const r = invRow_(d.nome);
      if (d.classe !== undefined) setInv_(r, 'Classe', typeof d.classe === 'object' ? fmtClasse_(d.classe) : d.classe);
      if (d.codice !== undefined) setInv_(r, COL_COD, String(d.codice).trim().toUpperCase());
      if (d.gruppo !== undefined) setInv_(r, 'Gruppo', d.gruppo);
      if (d.campi && typeof d.campi === 'object') Object.keys(d.campi).forEach(k => {
        if (['Nome', '_row'].indexOf(k) < 0) { colonna_(k); setInv_(r, k, d.campi[k]); } });
      const numeri = ['quote', 'prezzo', 'valore', 'versato'].some(k => d[k] !== undefined && d[k] !== '');
      if (numeri) {
        orig(d);
        if (d.prezzo !== undefined && d.prezzo !== '') { setInv_(r, 'Data prezzo', new Date()); setInv_(r, 'Fonte prezzo', 'manuale'); }
      }
      return { nome: d.nome };
    };
    updateInvestimento_._v2 = true;
  }
})();

// ============ struttura del foglio ============
function schema_() {
  const sh = sh_(SHEETS.INV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  INV_EXTRA.forEach(h => { if (head.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold'); } });
  if (!ss_().getSheetByName(ACQ)) {
    const a = ss_().insertSheet(ACQ);
    a.getRange(1, 1, 1, ACQ_HEAD.length).setValues([ACQ_HEAD]).setFontWeight('bold');
    a.setFrozenRows(1);
  }
  delete _mem['r_' + SHEETS.INV]; delete _mem['r_' + ACQ];
}

/** Crea la colonna nel foglio Investimenti se non c'è ancora. */
function colonna_(nome) {
  const sh = sh_(SHEETS.INV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (head.indexOf(nome) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(nome).setFontWeight('bold');
}

function invRow_(nome) {
  delete _mem['r_' + SHEETS.INV];
  const r = rows_(SHEETS.INV).find(x => x['Nome'] === nome);
  if (!r) throw new Error('Investimento non trovato: ' + nome);
  return r;
}
function setInv_(r, col, v) {
  const sh = sh_(SHEETS.INV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const c = head.indexOf(col);
  if (c < 0) return;
  sh.getRange(r._row, c + 1).setValue(v);
  r[col] = v;
}

// ============ tipo di titolo ============
function parseClasse_(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  if (/^az/.test(s)) return { az: 100, ob: 0, lq: 0 };
  if (/^ob/.test(s)) return { az: 0, ob: 100, lq: 0 };
  if (/^(li|mo)/.test(s)) return { az: 0, ob: 0, lq: 100 };
  const m = s.match(/(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)/);
  if (m) {
    const a = num_(m[1]), o = num_(m[2]), l = num_(m[3]), t = a + o + l;
    if (t) return { az: a / t * 100, ob: o / t * 100, lq: l / t * 100 };
  }
  return null;
}
function fmtClasse_(c) {
  if (!c) return '';
  if (c.az >= 99.99) return 'Azioni';
  if (c.ob >= 99.99) return 'Obbligazioni';
  if (c.lq >= 99.99) return 'Monetario';
  return 'Misto ' + [c.az, c.ob, c.lq].map(x => String(Math.round(x * 100) / 100).replace('.', ',')).join('/');
}

// ============ acquisti e PAC ============
function acquisti_() {
  if (!ss_().getSheetByName(ACQ)) return [];
  return rows_(ACQ).map(a => ({
    id: String(a['ID']), data: ymd_(a['Data']), investimento: a['Investimento'],
    importo: num_(a['Importo']), prezzo: num_(a['Prezzo']), quote: num_(a['Quote']), note: a['Note'] || '',
  })).sort((a, b) => (a.data < b.data ? -1 : 1));
}

/** Rendimento annualizzato (XIRR) da una lista di flussi {d:Date, v:numero}. */
function xirr_(flows) {
  if (flows.length < 2) return null;
  flows = flows.slice().sort((a, b) => a.d - b.d);
  const t0 = flows[0].d.getTime();
  const yrs = f => (f.d.getTime() - t0) / 31557600000;
  if (yrs(flows[flows.length - 1]) < 30 / 365) return null; // troppo presto per un dato sensato
  const npv = r => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, yrs(f)), 0);
  let lo = -0.99, hi = 10, flo = npv(lo);
  if (flo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

function riepilogoAcquisti_(lista, valore) {
  const quote = lista.reduce((s, a) => s + a.quote, 0);
  const versato = lista.reduce((s, a) => s + a.importo, 0);
  const flows = lista.map(a => ({ d: toDate_(a.data), v: -a.importo }));
  if (valore > 0) flows.push({ d: new Date(), v: valore });
  const x = xirr_(flows);
  return {
    n: lista.length, quote, versato: round2_(versato),
    prezzoMedio: quote ? versato / quote : null,
    primo: lista.length ? lista[0].data : '', ultimo: lista.length ? lista[lista.length - 1].data : '',
    annualizzato: x === null ? null : round2_(x * 100),
    acquisti: lista.slice(-120).reverse(),
  };
}

/** Aggiunge alla dashboard: tipo, fonte del prezzo, dati PAC. Ricalcola i totali. */
function arricchisci_(r) {
  const righe = rows_(SHEETS.INV);
  const acq = acquisti_();
  r.investimenti.forEach(i => {
    const row = righe.find(x => x['Nome'] === i.nome) || {};
    i.classe = parseClasse_(row['Classe']);
    i.fontePrezzo = String(row['Fonte prezzo'] || '');
    i.dataPrezzo = row['Data prezzo'] ? ymd_(row['Data prezzo']) : '';
    i.gruppo = String(row['Gruppo'] || '');
    i.campi = {};
    Object.keys(row).forEach(k => { if (k && k !== '_row') i.campi[k] = row[k] instanceof Date ? ymd_(row[k]) : row[k]; });
    const lista = acq.filter(a => a.investimento === i.nome);
    if (lista.length) {
      const q = lista.reduce((s, a) => s + a.quote, 0);
      if (i.prezzo) i.valore = round2_(q * i.prezzo);
      i.pac = riepilogoAcquisti_(lista, i.valore);
      i.quote = q; i.versato = i.pac.versato;
      i.rendimento = i.versato ? round2_((i.valore - i.versato) / i.versato * 100) : null;
    }
  });
  r.investimentiTotale = round2_(r.investimenti.reduce((s, i) => s + i.valore, 0));
  r.patrimonio = round2_(r.liquidita + r.investimentiTotale);
  r._v2 = true;
}

/** Ricalcola quote e versato dell'investimento dagli acquisti registrati. */
function ricalcola_(nome) {
  delete _mem['r_' + ACQ];
  const r = invRow_(nome);
  const lista = acquisti_().filter(a => a.investimento === nome);
  const q = lista.reduce((s, a) => s + a.quote, 0), v = lista.reduce((s, a) => s + a.importo, 0);
  const p = num_(r['Prezzo']);
  setInv_(r, 'Quote', round6_(q));
  setInv_(r, 'Versato', round2_(v));
  if (p) setInv_(r, 'Valore', round2_(q * p));
  setInv_(r, 'Aggiornato', new Date());
}
function round6_(n) { return Math.round(n * 1e6) / 1e6; }

/** d: { nome, data, importo, prezzo?, quote?, note? } — serve almeno uno tra prezzo e quote */
function addAcquisto_(d) {
  schema_();
  const r = invRow_(d.nome);
  const importo = Math.abs(num_(d.importo));
  if (!importo) throw new Error('Importo mancante');
  let prezzo = num_(d.prezzo), quote = num_(d.quote);
  if (!quote && prezzo) quote = importo / prezzo;
  if (!prezzo && quote) prezzo = importo / quote;
  if (!quote) throw new Error('Serve il prezzo o il numero di quote');
  const sh = sh_(ACQ);
  // primo acquisto registrato su un titolo che ha già quote: salva prima la posizione di partenza
  const esistenti = acquisti_().filter(a => a.investimento === d.nome);
  const q0 = num_(r['Quote']);
  if (!esistenti.length && q0 > 0) {
    const v0 = num_(r['Versato']) || q0 * num_(r['Prezzo']);
    sh.appendRow([Utilities.getUuid().slice(0, 8), toDate_(r['Aggiornato'] || new Date()), d.nome, round2_(v0),
      v0 / q0, q0, 'Posizione iniziale' + (num_(r['Versato']) ? '' : ' (versato stimato: correggilo)'), new Date()]);
  }
  const id = Utilities.getUuid().slice(0, 8);
  const data = toDate_(d.data || new Date());
  sh.appendRow([id, data, d.nome, round2_(importo), prezzo, round6_(quote), d.note || '', new Date()]);
  // se è il prezzo più recente che conosciamo, aggiornalo
  const dp = r['Data prezzo'] ? toDate_(r['Data prezzo']) : null;
  if (!dp || data >= dp) { setInv_(r, 'Prezzo', prezzo); setInv_(r, 'Data prezzo', data); setInv_(r, 'Fonte prezzo', 'acquisto'); }
  ricalcola_(d.nome);
  return { id };
}

function deleteAcquisto_(id) {
  delete _mem['r_' + ACQ];
  const a = rows_(ACQ).find(x => String(x['ID']) === String(id));
  if (!a) throw new Error('Acquisto non trovato');
  sh_(ACQ).deleteRow(a._row);
  ricalcola_(a['Investimento']);
  return { id };
}

/** d: { nome, codice?, classe?, quote?, prezzo?, valore?, versato? } */
function addInvestimento_(d) {
  schema_();
  const nome = String(d.nome || '').trim();
  if (!nome) throw new Error('Nome mancante');
  if (rows_(SHEETS.INV).some(x => x['Nome'] === nome)) throw new Error('Esiste già un investimento con questo nome');
  const sh = sh_(SHEETS.INV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const v = { 'Nome': nome, [COL_COD]: String(d.codice || '').trim().toUpperCase(), 'Quote': num_(d.quote) || '', 'Prezzo': num_(d.prezzo) || '',
    'Valore': num_(d.valore) || '', 'Versato': num_(d.versato) || '', 'Aggiornato': new Date(),
    'Classe': d.classe ? (typeof d.classe === 'object' ? fmtClasse_(d.classe) : d.classe) : '', 'Gruppo': d.gruppo || '' };
  sh.appendRow(head.map(h => (v[h] !== undefined ? v[h] : '')));
  delete _mem['r_' + SHEETS.INV];
  let prezzo = null;
  if (v[COL_COD]) { try { prezzo = aggiornaPrezzi_(nome)[0]; } catch (e) { } }
  return { nome, prezzo };
}

function deleteInvestimento_(nome) {
  const r = invRow_(nome);
  if (acquisti_().some(a => a.investimento === nome)) throw new Error('Ha degli acquisti registrati: eliminali prima');
  sh_(SHEETS.INV).deleteRow(r._row);
  return { nome };
}

// ============ prezzi da internet ============
const UA_ = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
};
function scarica_(url) {
  const r = UrlFetchApp.fetch(url, { headers: UA_, muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error(url.split('/')[2] + ' ' + r.getResponseCode());
  return r.getContentText();
}

function yahooChart_(sym) {
  const j = JSON.parse(scarica_('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5d&interval=1d'));
  const m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || !m.regularMarketPrice) throw new Error('Yahoo: nessun prezzo per ' + sym);
  let p = m.regularMarketPrice, val = m.currency || '';
  if (val === 'GBp') { p = p / 100; val = 'GBP'; }
  return { prezzo: p, valuta: val, data: m.regularMarketTime ? new Date(m.regularMarketTime * 1000) : new Date(), fonte: 'Yahoo ' + sym };
}

function yahooIsin_(isin) {
  const j = JSON.parse(scarica_('https://query2.finance.yahoo.com/v1/finance/search?q=' + isin + '&quotesCount=10&newsCount=0'));
  const simboli = (j.quotes || []).map(q => q.symbol).filter(Boolean);
  if (!simboli.length) throw new Error('Yahoo: ISIN non trovato');
  const pref = ['.MI', '.DE', '.F', '.AS', '.PA', '.SG', '.MU'];
  const rank = s => { const k = pref.findIndex(x => s.endsWith(x)); return k < 0 ? 50 : k; };
  simboli.sort((a, b) => rank(a) - rank(b));
  let primo = null;
  for (const s of simboli.slice(0, 4)) {
    try { const r = yahooChart_(s); if (r.valuta === 'EUR') return r; primo = primo || r; } catch (e) { }
  }
  if (primo) return primo;
  throw new Error('Yahoo: prezzo non disponibile');
}

/** Financial Times: buono per i fondi comuni cercati per ISIN. */
function ftFondo_(isin) {
  for (const val of ['EUR', 'USD']) {
    let html;
    try { html = scarica_('https://markets.ft.com/data/funds/tearsheet/summary?s=' + isin + ':' + val); } catch (e) { continue; }
    const m = html.match(/mod-ui-data-list__value">\s*([\d,]+(?:\.\d+)?)\s*</);
    if (!m) continue;
    const dm = html.match(/as of ([A-Z][a-z]{2} \d{1,2} \d{4})/);
    return { prezzo: parseFloat(m[1].replace(/,/g, '')), valuta: val, data: dm ? new Date(dm[1]) : new Date(), fonte: 'FT' };
  }
  throw new Error('FT: fondo non trovato');
}

/** Prezzo dal codice: ISIN (12 caratteri) oppure ticker Yahoo (es. SWDA.MI). */
function prezzoDa_(codice) {
  const c = String(codice || '').trim().toUpperCase();
  if (!c) throw new Error('Codice mancante');
  const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(c);
  const fonti = isin ? [() => yahooIsin_(c), () => ftFondo_(c)] : [() => yahooChart_(c)];
  const errori = [];
  for (const f of fonti) {
    try { const r = f(); if (r && r.prezzo > 0) return r; } catch (e) { errori.push(String(e.message || e)); }
  }
  throw new Error(errori.join(' · ') || 'nessuna fonte');
}

/** Aggiorna i prezzi di tutti gli investimenti con un codice (o solo di "nome"). */
function aggiornaPrezzi_(nome) {
  schema_();
  const esiti = [];
  rows_(SHEETS.INV).forEach(r => {
    if (nome && r['Nome'] !== nome) return;
    const cod = String(r[COL_COD] || '').trim();
    if (!cod) return;
    try {
      const p = prezzoDa_(cod);
      const prima = num_(r['Prezzo']);
      // controllo di sicurezza: un salto di oltre il 40% è quasi sempre un dato sbagliato
      if (prima && Math.abs(p.prezzo / prima - 1) > 0.4) throw new Error('prezzo sospetto ' + p.prezzo + ' (prima ' + prima + '), non salvato');
      const q = num_(r['Quote']);
      setInv_(r, 'Prezzo', p.prezzo);
      setInv_(r, 'Data prezzo', p.data);
      setInv_(r, 'Fonte prezzo', p.fonte + (p.valuta && p.valuta !== 'EUR' ? ' · in ' + p.valuta : ''));
      if (q) setInv_(r, 'Valore', round2_(q * p.prezzo));
      setInv_(r, 'Aggiornato', new Date());
      esiti.push({ nome: r['Nome'], ok: true, prezzo: p.prezzo, valuta: p.valuta, data: ymd_(p.data), fonte: p.fonte });
    } catch (e) {
      const msg = String(e.message || e).slice(0, 120);
      setInv_(r, 'Fonte prezzo', '⚠ ' + msg);
      esiti.push({ nome: r['Nome'], ok: false, errore: msg });
    }
  });
  PROPS.setProperty('PREZZI_ULTIMO', new Date().toISOString());
  return esiti;
}

/** Eseguita dal timer: ogni 2 ore, solo di giorno. */
function aggiornaPrezziAuto() {
  const h = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  if (h < 8 || h > 22) return;
  withLock_(() => aggiornaPrezzi_());
}

/** ESEGUI UNA VOLTA: autorizza l'accesso a internet, prepara il foglio, crea il timer e fa il primo aggiornamento. */
function attivaPrezzi() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'aggiornaPrezziAuto').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('aggiornaPrezziAuto').timeBased().everyHours(2).create();
  const esiti = withLock_(() => aggiornaPrezzi_());
  console.log('Prezzi automatici attivi (ogni 2 ore, dalle 8 alle 22).');
  console.log(JSON.stringify(esiti, null, 2));
}

function disattivaPrezzi() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'aggiornaPrezziAuto').forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Prezzi automatici disattivati');
}

/** Prova: mostra cosa trova per ogni codice, senza scrivere nel foglio. */
function testPrezzi() {
  rows_(SHEETS.INV).forEach(r => {
    const cod = String(r[COL_COD] || '').trim();
    if (!cod) { console.log(r['Nome'] + ': nessun codice'); return; }
    try { console.log(r['Nome'] + ' → ' + JSON.stringify(prezzoDa_(cod))); }
    catch (e) { console.log(r['Nome'] + ' → ERRORE ' + e.message); }
  });
  const p = acquisti_();
  console.log('Acquisti registrati: ' + p.length);
  // prova del calcolo PAC con l'esempio: 1000 € a 3, poi 3 rate da 100 €
  const es = [{ data: '2025-11-01', importo: 1000, quote: 1000 / 3 }, { data: '2025-12-01', importo: 100, quote: 100 / 2.8 },
    { data: '2026-01-01', importo: 100, quote: 100 / 3.1 }, { data: '2026-02-01', importo: 100, quote: 100 / 3.2 }];
  const q = es.reduce((s, a) => s + a.quote, 0);
  console.log('Esempio PAC → ' + JSON.stringify(riepilogoAcquisti_(es, q * 3.2)));
}

/**
 * FINANZE APP — motore (backend) in Google Apps Script
 * -----------------------------------------------------
 * Progetto Apps Script autonomo collegato al foglio "Finanze App - Database"
 * (vedi DB_ID). Il foglio fa da database, questo script da API.
 *
 * Moduli:
 *   1. Config & utilità
 *   2. Router API (doGet / doPost)
 *   3. Letture (config, dashboard, movimenti)
 *   4. Scritture (aggiungi / elimina movimento, aggiorna investimento)
 *   5. Integrazione SMS (testo dell'SMS della banca → movimento)
 *   6. Integrazione foglio "Asset" (opzionale)
 *   7. Setup e test
 */

// ============ 1. CONFIG & UTILITÀ ============

const SHEETS = {
  MOV: 'Movimenti',
  CONTI: 'Conti',
  CAT: 'Categorie',
  INV: 'Investimenti',
  REG: 'Regole',
};
const TZ = 'Europe/Rome';
const PROPS = PropertiesService.getScriptProperties();

const DB_ID = '1Iyir7HD1YP0QiPDDeqgkT9G0XgwB2gwRjCPucTF6HCE'; // foglio "Finanze App - Database"
// Memoria per la durata di una richiesta: ogni foglio viene aperto e letto UNA sola volta
const _mem = {};
function ss_() { return _mem.ss || (_mem.ss = SpreadsheetApp.openById(DB_ID)); }

// Cache di 5 minuti per i dati di Asset (foglio pesante): si svuota a ogni scrittura fatta dall'app
const CACHE_MIN = 5;
function cacheGet_(k) {
  const c = CacheService.getScriptCache(), n = Number(c.get(k + '_n') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(k + '_' + i);
  const parts = c.getAll(keys);
  if (keys.some(x => parts[x] == null)) return null;
  try { return JSON.parse(keys.map(x => parts[x]).join('')); } catch (e) { return null; }
}
function cachePut_(k, obj) {
  const s = JSON.stringify(obj), size = 90000, put = {};
  const n = Math.ceil(s.length / size);
  for (let i = 0; i < n; i++) put[k + '_' + i] = s.substr(i * size, size);
  put[k + '_n'] = String(n);
  try { CacheService.getScriptCache().putAll(put, CACHE_MIN * 60); return true; } catch (e) { console.warn('cache: ' + e); return false; }
}
// Svuota la cache di Asset dopo una scrittura, a meno che la scrittura l'abbia già aggiornata (_mem.cacheAggiornata).
// Lo Storico NW non dipende dai movimenti (i flussi si ricalcolano a ogni richiesta), quindi la sua cache resta.
function cacheClear_() {
  if (_mem.cacheAggiornata) return;
  CacheService.getScriptCache().removeAll(['asset_n', 'storico_n']);
}
// Foglio "Asset": i suoi movimenti storici vengono letti (solo lettura) e uniti a quelli dell'app
const ASSET_ID = PROPS.getProperty('ASSET_ID') || '1oVrRX1yv78Cy2STKXqFLCX43nLTlCv-O4iXJcs6hC2g';
function sh_(name) { return ss_().getSheetByName(name); }

/** Righe di un foglio come array di oggetti {intestazione: valore}, con _row = numero riga. */
function rows_(name) {
  if (_mem['r_' + name]) return _mem['r_' + name];
  const values = sh_(name).getDataRange().getValues();
  const head = values.shift();
  const out = values
    .map((r, i) => {
      const o = { _row: i + 2 };
      head.forEach((h, j) => (o[h] = r[j]));
      return o;
    })
    .filter(o => head.some(h => o[h] !== '' && o[h] !== null));
  _mem['r_' + name] = out;
  return out;
}

function num_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return 0;
  // accetta "1.234,56", "1234,56", "1234.56", "-12,5"
  let s = String(v).replace(/[€\s]/g, '');
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return new Date();
  const s = String(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);           // 2026-11-13
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);      // 13/11/2026
  if (m) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[2] - 1, +m[1], 12);
  const d = new Date(s);
  return isNaN(d) ? new Date() : d;
}

function ymd_(d) { return Utilities.formatDate(toDate_(d), TZ, 'yyyy-MM-dd'); }
function ym_(d) { return Utilities.formatDate(toDate_(d), TZ, 'yyyy-MM'); }
function round2_(n) { return Math.round(n * 100) / 100; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ 2. ROUTER API ============

function doGet(e) {
  return handle_(e.parameter || {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { body = {}; }
  // permette anche ?token=...&action=... nell'URL (comodo per Comandi di iPhone)
  return handle_(Object.assign({}, e.parameter || {}, body));
}

function handle_(p) {
  try {
    if (!p.token || p.token !== PROPS.getProperty('API_TOKEN')) {
      return json_({ ok: false, error: 'Token non valido' });
    }
    const d = p.data && typeof p.data === 'object' ? p.data : p;
    const actions = {
      config: () => getConfig_(),
      dashboard: () => getDashboard_(p.mese),
      movimenti: () => getMovimenti_(p.mese),
      storico: () => getStorico_(),
      init: () => ({ config: getConfig_(), dashboard: getDashboard_(p.mese), movimenti: getMovimenti_(p.mese) }),
      addMovimento: () => conInit_(withLock_(() => addMovimento_(d)), d._mese),
      deleteMovimento: () => withLock_(() => deleteMovimento_(d.id || p.id, d.fp)),
      updateMovimento: () => withLock_(() => updateMovimento_(d)),
      confermaMovimento: () => withLock_(() => updateMovimento_(Object.assign({}, d, { conferma: true }))),
      updateInvestimento: () => withLock_(() => updateInvestimento_(d)),
      sms: () => withLock_(() => fromSms_(p.testo || p.text || '')),
    };
    const fn = actions[p.action];
    if (!fn) return json_({ ok: false, error: 'Azione sconosciuta: ' + p.action });
    return json_({ ok: true, data: fn() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); cacheClear_(); Object.keys(_mem).forEach(k => { if (k !== 'ss' && k !== 'assetSs') delete _mem[k]; }); }
}

/** Dopo addMovimento: se l'app passa _mese, risponde già con i dati aggiornati (una chiamata invece di due) */
function conInit_(mov, mese) {
  if (!mese) return mov;
  mov.init = { config: getConfig_(), dashboard: getDashboard_(mese), movimenti: getMovimenti_(mese) };
  return mov;
}

// ============ 3. LETTURE ============

function getConfig_() {
  const categorie = rows_(SHEETS.CAT).map(c => ({
    tipo: c['Tipo'], nome: c['Nome'], budget: num_(c['Budget mensile']),
  }));
  const conti = rows_(SHEETS.CONTI)
    .filter(c => String(c['Attivo']).toLowerCase() !== 'no')
    .map(c => ({ nome: c['Nome'], tipo: c['Tipo'] }));
  return { categorie, conti };
}

function getMovimenti_(mese) {
  const m = mese || ym_(new Date());
  return allMovs_()
    .filter(mv => mv.data.slice(0, 7) === m)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.creato - a.creato));
}

/** Movimenti dalla tab "Movimenti" di Asset: Cod (MMAA) | Categoria | Valore | Note | Data | Fonte */
function assetMovs_() {
  if (!ASSET_ID || ASSET_ID === 'off') return [];
  if (_mem.asset) return _mem.asset;
  const cached = cacheGet_('asset');
  if (cached) return (_mem.asset = cached);
  try {
    const values = assetSheet_().getDataRange().getValues();
    values.shift();
    const out = [];
    values.forEach((r, i) => {
      const cod = String(r[0]).trim(), imp = num_(r[2]);
      if (!cod || !imp) return;
      const yy = cod.slice(-2), mm = cod.slice(0, -2).padStart(2, '0');
      const hasDate = r[4] instanceof Date || (r[4] && String(r[4]).match(/\d/));
      const data = hasDate ? ymd_(r[4]) : '20' + yy + '-' + mm + '-01';
      out.push({
        id: 'A' + (i + 2), fp: fp_(r), data, importo: imp, tipo: '', categoria: r[1], conto: 'Fideuram',
        descrizione: r[3] || '', fonte: String(r[5] || 'Asset'), creato: 1e9 - i,
        senzaData: !hasDate,
      });
    });
    _mem.asset = out;
    cachePut_('asset', out);
    return out;
  } catch (err) {
    console.warn('Lettura Asset non riuscita: ' + err);
    return [];
  }
}

/**
 * La nuova riga è stata inserita in riga 2 di Asset: aggiorna la cache invece di svuotarla.
 * Le righe esistenti scendono di una (id A3 → A4…). Se la cache non c'è o non si salva, viene svuotata come prima.
 */
function aggiungiACacheAsset_(r) {
  const list = _mem.asset || cacheGet_('asset');
  if (!list) return;
  const nuova = {
    id: 'A2', fp: fp_(r), data: ymd_(r[4]), importo: num_(r[2]), tipo: '', categoria: r[1], conto: 'Fideuram',
    descrizione: r[3] || '', fonte: String(r[5] || 'Asset'), creato: 1e9, senzaData: false,
  };
  const out = [nuova].concat(list.map(m => Object.assign({}, m, { id: 'A' + (Number(String(m.id).slice(1)) + 1), creato: m.creato - 1 })));
  if (cachePut_('asset', out)) { _mem.asset = out; _mem.cacheAggiornata = true; }
}

// ---- Scrittura sulla tab Movimenti di Asset (archivio unico dei movimenti) ----
function usaAsset_() { return ASSET_ID && ASSET_ID !== 'off'; }
function assetSs_() { return _mem.assetSs || (_mem.assetSs = SpreadsheetApp.openById(ASSET_ID)); }
function assetSheet_() { return assetSs_().getSheetByName('Movimenti'); }

/** "Impronta" di una riga: serve a ritrovarla anche se nel frattempo le righe si sono spostate */
function fp_(r) {
  const hasDate = r[4] instanceof Date || (r[4] && String(r[4]).match(/\d/));
  return [String(r[0]).trim(), r[1], round2_(num_(r[2])), String(r[3] || '').trim(), hasDate ? ymd_(r[4]) : ''].join('|');
}

/** Trova la riga in Asset: prima prova il numero di riga, poi cerca per impronta */
function findAssetRow_(id, fp) {
  const sh = assetSheet_();
  const values = sh.getDataRange().getValues();
  const n = Number(String(id).slice(1));
  if (n >= 2 && values[n - 1] && (!fp || fp_(values[n - 1]) === fp)) return { sh, row: n, values: values[n - 1] };
  if (fp) for (let i = 1; i < values.length; i++) if (fp_(values[i]) === fp) return { sh, row: i + 1, values: values[i] };
  throw new Error('Movimento non trovato (il foglio è cambiato): aggiorna l\'app e riprova');
}

/** La nuova riga 2 prende formato e menu a tendina dalla riga sotto (non dall'intestazione) */
function copiaFormato_(sh) {
  const lc = Math.max(6, sh.getLastColumn());
  const src = sh.getRange(3, 1, 1, lc), dst = sh.getRange(2, 1, 1, lc);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
}

function codAsset_(d) { return Utilities.formatDate(d, TZ, 'M') + Utilities.formatDate(d, TZ, 'yy'); }

/** Modifica un movimento (in Asset o nel database). d: { id, fp, importo?, categoria?, descrizione?, data?, conferma? } */
function updateMovimento_(d) {
  if (String(d.id).charAt(0) === 'A') {
    const f = findAssetRow_(d.id, d.fp);
    const r = f.values.slice(0, 6);
    while (r.length < 6) r.push('');
    if (d.categoria !== undefined && d.categoria !== '') r[1] = d.categoria;
    if (d.importo !== undefined && d.importo !== '') {
      let imp = num_(d.importo);
      const tipo = tipoDiCategoria_(r[1]);
      if (tipo === 'uscite' || tipo === 'mov') imp = -Math.abs(imp);
      if (tipo === 'entrate') imp = Math.abs(imp);
      r[2] = round2_(imp);
    }
    if (d.descrizione !== undefined) r[3] = d.descrizione;
    if (d.data) { r[4] = toDate_(d.data); r[0] = codAsset_(r[4]); }
    if (d.conferma) r[5] = String(r[5] || '').replace(/\s*·?\s*DA VERIFICARE/i, '').trim();
    f.sh.getRange(f.row, 1, 1, 6).setValues([r]);
    return { id: d.id };
  }
  // movimento nel database dell'app
  const row = rows_(SHEETS.MOV).find(x => String(x['ID']) === String(d.id));
  if (!row) throw new Error('Movimento non trovato');
  const sh = sh_(SHEETS.MOV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const set = (col, v) => sh.getRange(row._row, head.indexOf(col) + 1).setValue(v);
  if (d.categoria) { set('Categoria', d.categoria); set('Tipo', tipoDiCategoria_(d.categoria)); }
  if (d.importo !== undefined && d.importo !== '') {
    const t = tipoDiCategoria_(d.categoria || row['Categoria']);
    set('Importo', round2_(t === 'entrate' ? Math.abs(num_(d.importo)) : -Math.abs(num_(d.importo))));
  }
  if (d.descrizione !== undefined) set('Descrizione', d.descrizione);
  if (d.data) set('Data', toDate_(d.data));
  if (d.conferma) set('Fonte', String(row['Fonte'] || '').replace(/\s*·?\s*DA VERIFICARE/i, '').trim());
  return { id: d.id };
}

/** Tutti i movimenti: quelli dell'app (database) + quelli storici di Asset */
function allMovs_() {
  return rows_(SHEETS.MOV).map(movToJson_).concat(assetMovs_());
}

function movToJson_(r) {
  return {
    id: String(r['ID']),
    data: ymd_(r['Data']),
    importo: num_(r['Importo']),
    tipo: r['Tipo'],
    categoria: r['Categoria'],
    conto: r['Conto'],
    descrizione: r['Descrizione'],
    fonte: r['Fonte'],
    creato: r['Creato'] instanceof Date ? r['Creato'].getTime() : 0,
  };
}

function getDashboard_(mese) {
  const m = mese || ym_(new Date());
  if (_mem['d_' + m]) return _mem['d_' + m];
  const [y, mm] = m.split('-').map(Number);
  const prev = Utilities.formatDate(new Date(y, mm - 2, 15), TZ, 'yyyy-MM');

  const movs = allMovs_();
  const cats = rows_(SHEETS.CAT);
  const tipoCat = {};
  cats.forEach(c => (tipoCat[c['Nome']] = c['Tipo']));

  // --- Saldi conti: saldo iniziale + movimenti dalla data del saldo iniziale in poi
  const conti = rows_(SHEETS.CONTI)
    .filter(c => String(c['Attivo']).toLowerCase() !== 'no')
    .map(c => {
      const da = ymd_(c['Data saldo iniziale']);
      const delta = movs
        .filter(mv => mv.conto === c['Nome'] && !mv.senzaData && mv.data >= da)
        .reduce((s, mv) => s + mv.importo, 0);
      return { nome: c['Nome'], tipo: c['Tipo'], saldo: round2_(num_(c['Saldo iniziale']) + delta) };
    });
  const liquidita = round2_(conti.reduce((s, c) => s + c.saldo, 0));

  // --- Investimenti
  const investimenti = rows_(SHEETS.INV).map(i => {
    const q = num_(i['Quote']), pr = num_(i['Prezzo']);
    const valore = q && pr ? q * pr : num_(i['Valore']);
    const versato = num_(i['Versato']);
    return {
      nome: i['Nome'], codice: i['Codice (ISIN/ticker)'], quote: q, prezzo: pr,
      valore: round2_(valore), versato,
      rendimento: versato ? round2_(((valore - versato) / versato) * 100) : null,
      aggiornato: i['Aggiornato'] ? ymd_(i['Aggiornato']) : '',
    };
  });
  const totInv = round2_(investimenti.reduce((s, i) => s + i.valore, 0));

  // --- Mese
  const delMese = movs.filter(mv => mv.data.slice(0, 7) === m);
  const tipoOf = mv => mv.tipo || tipoCat[mv.categoria] || (mv.importo >= 0 ? 'entrate' : 'uscite');
  const entrate = delMese.filter(mv => tipoOf(mv) === 'entrate').reduce((s, mv) => s + mv.importo, 0);
  const uscite = -delMese.filter(mv => tipoOf(mv) === 'uscite').reduce((s, mv) => s + mv.importo, 0);
  const investito = -delMese.filter(mv => tipoOf(mv) === 'mov').reduce((s, mv) => s + mv.importo, 0);
  const uscitePrec = -movs
    .filter(mv => mv.data.slice(0, 7) === prev && tipoOf(mv) === 'uscite')
    .reduce((s, mv) => s + mv.importo, 0);

  // --- Budget per categoria
  const spesoPer = {};
  delMese.filter(mv => tipoOf(mv) === 'uscite')
    .forEach(mv => (spesoPer[mv.categoria] = (spesoPer[mv.categoria] || 0) - mv.importo));
  const budget = cats
    .filter(c => c['Tipo'] === 'uscite' && (num_(c['Budget mensile']) > 0 || spesoPer[c['Nome']]))
    .map(c => {
      const b = num_(c['Budget mensile']), sp = round2_(spesoPer[c['Nome']] || 0);
      return { categoria: c['Nome'], budget: b, speso: sp, residuo: round2_(b - sp), uso: b ? sp / b : null };
    })
    .sort((a, b) => (b.uso || 0) - (a.uso || 0));
  const budgetTot = budget.reduce((s, b) => s + b.budget, 0);
  const spesoInBudget = budget.filter(b => b.budget > 0).reduce((s, b) => s + b.speso, 0);

  // giorni rimanenti nel mese (se è il mese corrente)
  const oggi = new Date();
  const fineMese = new Date(y, mm, 0).getDate();
  const giorniRimasti = m === ym_(oggi) ? fineMese - Number(Utilities.formatDate(oggi, TZ, 'd')) + 1 : 0;

  const res = {
    mese: m,
    patrimonio: round2_(liquidita + totInv),
    liquidita,
    investimentiTotale: totInv,
    conti,
    investimenti,
    entrate: round2_(entrate),
    uscite: round2_(uscite),
    investito: round2_(investito),
    saldo: round2_(entrate - uscite),
    uscitePrec: round2_(uscitePrec),
    tassoRisparmio: entrate ? round2_(((entrate - uscite) / entrate) * 100) : null,
    budget,
    budgetTotale: round2_(budgetTot),
    budgetResiduo: round2_(budgetTot - spesoInBudget),
    alGiorno: giorniRimasti ? round2_(Math.max(0, budgetTot - spesoInBudget) / giorniRimasti) : null,
    ultimi: delMese.sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 8),
  };
  _mem['d_' + m] = res;
  return res;
}

/**
 * Crescita del patrimonio: legge la tab "Storico NW" di Asset (Mese M/AAAA | EUR | Note)
 * e aggiunge, mese per mese, entrate / uscite / investito calcolati dai movimenti.
 */
function getStorico_() {
  let punti = cacheGet_('storico');
  if (!punti) { punti = []; try {
    const v = assetSs_().getSheetByName('Storico NW').getDataRange().getValues();
    v.shift();
    v.forEach(r => {
      let ym = '';
      if (r[0] instanceof Date) ym = ym_(r[0]);
      else {
        const m = String(r[0]).match(/(\d{1,2})\/(\d{4})/);
        if (m) ym = m[2] + '-' + m[1].padStart(2, '0');
      }
      const val = num_(r[1]);
      if (ym && val) punti.push({ mese: ym, valore: round2_(val), nota: String(r[2] || '').trim() });
    });
  } catch (err) { console.warn('Storico NW non leggibile: ' + err); }
  cachePut_('storico', punti); }

  // il mese corrente usa il valore live calcolato dall'app
  const live = getDashboard_();
  const cur = punti.find(x => x.mese === live.mese);
  if (cur) cur.valore = live.patrimonio; else punti.push({ mese: live.mese, valore: live.patrimonio, nota: '' });
  punti.sort((a, b) => (a.mese < b.mese ? -1 : 1));

  // flussi mensili dai movimenti
  const tipoCat = {};
  rows_(SHEETS.CAT).forEach(c => (tipoCat[c['Nome']] = c['Tipo']));
  const flussi = {};
  allMovs_().forEach(mv => {
    const k = mv.data.slice(0, 7);
    const t = mv.tipo || tipoCat[mv.categoria] || (mv.importo >= 0 ? 'entrate' : 'uscite');
    const f = flussi[k] || (flussi[k] = { entrate: 0, uscite: 0, investito: 0 });
    if (t === 'entrate') f.entrate += mv.importo;
    else if (t === 'uscite') f.uscite -= mv.importo;
    else if (t === 'mov') f.investito -= mv.importo;
  });
  punti.forEach(p => {
    const f = flussi[p.mese];
    if (f) { p.entrate = round2_(f.entrate); p.uscite = round2_(f.uscite); p.investito = round2_(f.investito); }
  });
  return { punti, attuale: live.patrimonio, liquidita: live.liquidita, investimenti: live.investimentiTotale };
}

// ============ 4. SCRITTURE ============

/**
 * data: { data:'2026-11-13', importo: 12.5, segno:'uscita'|'entrata' (opz.), categoria, conto, descrizione, fonte }
 * L'importo può arrivare positivo con "segno", oppure già con il segno.
 */
function addMovimento_(d) {
  let imp = num_(d.importo);
  if (!imp) throw new Error('Importo mancante');
  const cat = d.categoria || categorizza_(d.descrizione) || '';
  const tipo = d.tipo || tipoDiCategoria_(cat) || (d.segno === 'entrata' ? 'entrate' : 'uscite');
  if (d.segno === 'uscita' || (!d.segno && (tipo === 'uscite' || tipo === 'mov'))) imp = -Math.abs(imp);
  if (d.segno === 'entrata' || (!d.segno && tipo === 'entrate')) imp = Math.abs(imp);

  if (usaAsset_()) {
    const dt = toDate_(d.data);
    const sh = assetSheet_();
    sh.insertRowAfter(1);                  // i più recenti in alto, come nel tuo foglio
    copiaFormato_(sh);
    const riga = [codAsset_(dt), cat, round2_(imp), d.descrizione || '', dt, d.fonte || 'App'];
    sh.getRange(2, 1, 1, 6).setValues([riga]);
    aggiungiACacheAsset_(riga);            // evita di rileggere tutto Asset alla prossima richiesta
    return { id: 'A2', data: ymd_(dt), importo: round2_(imp), categoria: cat, descrizione: d.descrizione || '' };
  }

  const id = Utilities.getUuid().slice(0, 8);
  const row = [
    id, toDate_(d.data), round2_(imp), tipo, cat,
    d.conto || defaultConto_(), d.descrizione || '', d.fonte || 'App', new Date(),
  ];
  const sh = sh_(SHEETS.MOV);
  sh.insertRowAfter(1);                    // i più recenti in alto
  sh.getRange(2, 1, 1, row.length).setValues([row]);

  syncAsset_(row);                         // modulo 6 (se attivo)
  return movToJson_({
    ID: id, Data: row[1], Importo: row[2], Tipo: tipo, Categoria: cat,
    Conto: row[5], Descrizione: row[6], Fonte: row[7], Creato: row[8],
  });
}

function deleteMovimento_(id, fp) {
  if (String(id).charAt(0) === 'A') {
    const f = findAssetRow_(id, fp);
    f.sh.deleteRow(f.row);
    return { id };
  }
  const r = rows_(SHEETS.MOV).find(x => String(x['ID']) === String(id));
  if (!r) throw new Error('Movimento non trovato');
  sh_(SHEETS.MOV).deleteRow(r._row);
  return { id };
}

/** data: { nome, prezzo?, valore?, quote?, versato? } */
function updateInvestimento_(d) {
  const r = rows_(SHEETS.INV).find(x => x['Nome'] === d.nome);
  if (!r) throw new Error('Investimento non trovato');
  const sh = sh_(SHEETS.INV);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const set = (col, v) => sh.getRange(r._row, head.indexOf(col) + 1).setValue(v);
  if (d.quote !== undefined && d.quote !== '') set('Quote', num_(d.quote));
  if (d.prezzo !== undefined && d.prezzo !== '') set('Prezzo', num_(d.prezzo));
  if (d.versato !== undefined && d.versato !== '') set('Versato', num_(d.versato));
  const q = d.quote ? num_(d.quote) : num_(r['Quote']);
  const p = d.prezzo ? num_(d.prezzo) : num_(r['Prezzo']);
  set('Valore', q && p ? round2_(q * p) : num_(d.valore !== undefined ? d.valore : r['Valore']));
  set('Aggiornato', new Date());
  return { nome: d.nome };
}

function categorizza_(testo) {
  if (!testo) return '';
  const t = ' ' + String(testo).toLowerCase() + ' ';
  const regola = rows_(SHEETS.REG).find(r => r['Parola chiave'] && t.indexOf(String(r['Parola chiave']).toLowerCase()) > -1);
  return regola ? regola['Categoria'] : '';
}

function tipoDiCategoria_(cat) {
  const c = rows_(SHEETS.CAT).find(x => x['Nome'] === cat);
  return c ? c['Tipo'] : '';
}

function defaultConto_() {
  const c = rows_(SHEETS.CONTI)[0];
  return c ? c['Nome'] : '';
}

// ============ 5. INTEGRAZIONE SMS ============
/**
 * Riceve il testo di un SMS della banca (es. inoltrato da Comandi di iPhone)
 * e prova a ricavarne importo, esercente e segno. Se non riconosce la
 * categoria, la marca "DA VERIFICARE" così la sistemi dall'app.
 */
function fromSms_(testo) {
  if (!testo) throw new Error('Testo SMS vuoto');
  const t = String(testo);
  const amt = t.match(/(?:eur|€)\s*([0-9.]+,[0-9]{2}|[0-9]+(?:\.[0-9]{2})?)/i) ||
              t.match(/([0-9.]+,[0-9]{2}|[0-9]+\.[0-9]{2})\s*(?:eur|€)/i);
  if (!amt) throw new Error('Importo non trovato nel testo');
  const importo = num_(amt[1]);
  const entrata = /accredit|ricevut|stipendio|rimborso/i.test(t);
  const merch = t.match(/(?:presso|c\/o|da|at|esercente:?)\s+([A-Za-z0-9 .&'\-*]{2,40}?)(?:\s+(?:il|del|in data|con|carta|alle)\b|[.,;]|$)/i);
  const data = (t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1];
  const descrizione = merch ? merch[1].trim() : t.slice(0, 60);
  const categoria = categorizza_(descrizione) || categorizza_(t);
  return addMovimento_({
    data: data || new Date(),
    importo,
    segno: entrata ? 'entrata' : 'uscita',
    categoria,
    descrizione,
    fonte: 'SMS' + (categoria ? '' : ' · DA VERIFICARE'),
  });
}

// ============ 5b. INTEGRAZIONE PAYPAL (email in Gmail) ============
/**
 * Legge una volta al giorno le ricevute PayPal arrivate in Gmail e le aggiunge ad Asset.
 * - "Hai inviato X € a Nome"      -> uscita
 * - "Hai pagato X € a Negozio"     -> uscita
 * - "Nome ti ha inviato X €"       -> entrata
 * - "Hai ricevuto un rimborso da…" -> entrata
 * Niente doppioni: il codice transazione PayPal finisce nella colonna Fonte e viene controllato.
 * Vengono lette solo le email arrivate DOPO l'attivazione (le precedenti le hai già registrate).
 */
function attivaPaypal() {
  if (!PROPS.getProperty('PAYPAL_DA')) PROPS.setProperty('PAYPAL_DA', String(Math.floor(Date.now() / 1000)));
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importaPaypal').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importaPaypal').timeBased().everyDays(1).atHour(21).inTimezone(TZ).create();
  console.log('Import PayPal attivo: ogni giorno verso le 21. Email considerate da: ' + new Date(Number(PROPS.getProperty('PAYPAL_DA')) * 1000));
}

function disattivaPaypal() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importaPaypal').forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Import PayPal disattivato');
}

function testoEmail_(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** Interpreta una ricevuta PayPal. Restituisce null se l'email non è un movimento. */
function leggiPaypal_(oggetto, testo) {
  const EUR = '([0-9.]+,[0-9]{2}) ?€';
  let m, imp, chi, segno;
  if (/Hai ricevuto del denaro/i.test(oggetto) && /rimborso/i.test(testo)) return null; // conferma di un rimborso già notificato
  if ((m = testo.match(new RegExp('Hai inviato ' + EUR + '(?: EUR)? a (.+?) (?:Dettagli|Codice|Data)')))) { imp = m[1]; chi = m[2]; segno = 'uscita'; }
  else if ((m = testo.match(new RegExp('Hai pagato ' + EUR + '(?: EUR)? a (.+?) (?:Commerciante|Dettagli|Codice|Data)')))) { imp = m[1]; chi = m[2]; segno = 'uscita'; }
  else if ((m = testo.match(new RegExp('ti ha inviato un rimborso di ' + EUR)))) {
    imp = m[1]; segno = 'entrata';
    chi = 'Rimborso ' + ((oggetto.match(/rimborso da (.+)$/i) || [])[1] || '').trim();
  }
  else if ((m = testo.match(new RegExp('Ciao [^ ]+ [^ ]+ (.+?) ti ha inviato ' + EUR)))) { chi = m[1]; imp = m[2]; segno = 'entrata'; }
  else return null;
  const codice = (testo.match(/Codice transazione:? ([A-Z0-9]{12,20})/) || [])[1] || '';
  return { importo: num_(imp), descrizione: chi.replace(/\.\.\.$/, '').trim(), segno, codice };
}

function importaPaypal() {
  const da = Number(PROPS.getProperty('PAYPAL_DA') || 0);
  if (!da) throw new Error('Esegui prima attivaPaypal');
  const fatti = JSON.parse(PROPS.getProperty('PAYPAL_FATTI') || '[]');
  const fonti = assetSheet_().getRange('F:F').getValues().map(r => String(r[0]));
  let aggiunti = 0;
  GmailApp.search('from:(paypal.it OR paypal.com) after:' + da, 0, 50).reverse().forEach(th => {
    th.getMessages().forEach(msg => {
      const id = msg.getId();
      if (fatti.indexOf(id) > -1 || msg.getDate().getTime() / 1000 < da) return;
      fatti.push(id);
      const p = leggiPaypal_(msg.getSubject(), testoEmail_(msg.getBody()));
      if (!p || !p.importo) return;
      if (p.codice && fonti.some(f => f.indexOf(p.codice) > -1)) return; // già presente
      const categoria = categorizza_(p.descrizione);
      withLock_(() => addMovimento_({
        data: msg.getDate(), importo: p.importo, segno: p.segno, categoria,
        descrizione: p.descrizione,
        fonte: 'PayPal' + (p.codice ? ' · ' + p.codice : '') + (categoria ? '' : ' · DA VERIFICARE'),
      }));
      aggiunti++;
    });
  });
  PROPS.setProperty('PAYPAL_FATTI', JSON.stringify(fatti.slice(-300)));
  console.log('PayPal: ' + aggiunti + ' movimenti aggiunti');
  return aggiunti;
}

/** Prova la lettura sulle ultime ricevute PayPal senza scrivere niente. */
function testPaypal() {
  GmailApp.search('from:(paypal.it OR paypal.com) newer_than:90d', 0, 15).forEach(th => {
    const msg = th.getMessages()[0];
    console.log(msg.getSubject() + ' → ' + JSON.stringify(leggiPaypal_(msg.getSubject(), testoEmail_(msg.getBody()))));
  });
}

// ============ 6. INTEGRAZIONE FOGLIO "ASSET" (opzionale) ============
/**
 * Se nelle Proprietà script imposti ASSET_SYNC_ID = id del foglio "Asset",
 * ogni movimento inserito dall'app viene copiato anche nella tab "Movimenti"
 * di Asset, nel suo formato: Cod (MMAA) | Categoria | Valore | Note | Data | Fonte.
 * Attenzione ai doppioni se lo stesso movimento arriva già da un altro script.
 */
function syncAsset_(row) {
  const id = PROPS.getProperty('ASSET_SYNC_ID');
  if (!id) return;
  try {
    const sh = SpreadsheetApp.openById(id).getSheetByName('Movimenti');
    const d = row[1];
    const cod = Utilities.formatDate(d, TZ, 'MMyy');
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 6).setValues([[cod, row[4], row[2], row[6], d, 'App · ' + row[7]]]);
  } catch (err) {
    console.warn('Sync Asset non riuscita: ' + err);
  }
}

// ============ 7. SETUP E TEST ============

/** Eseguilo UNA volta dall'editor: crea il token segreto e lo mostra nel log. */
function setup() {
  let token = PROPS.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    PROPS.setProperty('API_TOKEN', token);
  }
  console.log('Il tuo token segreto (da inserire nell\'app): ' + token);
  return token;
}

/** Test rapido dall'editor: stampa la dashboard del mese. */
function testDashboard() {
  console.log(JSON.stringify(getDashboard_(), null, 2));
}

/** Test dell'interpretazione SMS (non scrive niente). */
function testSms() {
  const esempi = [
    'Pagamento di EUR 12,50 presso ESSELUNGA MILANO con carta *1234 il 13/11/2026',
    'Addebito 61,43 EUR c/o ENI STATION 1234',
    'Accredito stipendio EUR 1.216,40',
  ];
  esempi.forEach(t => {
    const amt = t.match(/(?:eur|€)\s*([0-9.]+,[0-9]{2}|[0-9]+(?:\.[0-9]{2})?)/i) ||
                t.match(/([0-9.]+,[0-9]{2}|[0-9]+\.[0-9]{2})\s*(?:eur|€)/i);
    const merch = t.match(/(?:presso|c\/o|da|at|esercente:?)\s+([A-Za-z0-9 .&'\-*]{2,40}?)(?:\s+(?:il|del|in data|con|carta|alle)\b|[.,;]|$)/i);
    console.log(t, '→', amt && num_(amt[1]), merch && merch[1], categorizza_(merch ? merch[1] : t));
  });
}

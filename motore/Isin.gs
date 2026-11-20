/**
 * FINANZE APP — NOME DEL TITOLO DALL'ISIN (o dal ticker)
 * ---------------------------------------------------------------------------
 * Azione "infoTitolo": dato un ISIN (o un ticker Yahoo) restituisce nome, tipo,
 * ticker e borsa. Serve al form "Nuovo titolo" per compilare il nome da solo.
 * Fonti in ordine: Yahoo Finance → Financial Times → OpenFIGI (Bloomberg).
 * Sola lettura: non scrive nel foglio. I risultati restano in cache 6 ore.
 * Usa scarica_ e UA_ di Prezzi.gs (deve stare sotto Prezzi nell'ordine dei file).
 */
aggancia_({ infoTitolo: d => infoTitolo_(d.codice) });

const ISIN_RE_ = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function infoTitolo_(codice) {
  const c = String(codice || '').trim().toUpperCase();
  if (!c) throw new Error('Codice mancante');
  const cache = CacheService.getScriptCache(), k = 'info_' + c;
  const hit = cache.get(k);
  if (hit) return JSON.parse(hit);
  const fonti = ISIN_RE_.test(c) ? [infoYahoo_, infoFT_, infoFigi_] : [infoYahoo_];
  const errori = [];
  for (const f of fonti) {
    try {
      const r = f(c);
      if (r && r.nome) {
        r.nome = pulisciNome_(r.nome); r.codice = c;
        cache.put(k, JSON.stringify(r), 21600);
        return r;
      }
    } catch (e) { errori.push(String(e.message || e)); }
  }
  throw new Error('Nome non trovato' + (errori.length ? ' (' + errori.join(' · ') + ')' : ''));
}

/** Yahoo: la stessa ricerca usata per i prezzi; preferisce le quotazioni europee. */
function infoYahoo_(c) {
  const j = JSON.parse(scarica_('https://query2.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(c) + '&quotesCount=10&newsCount=0'));
  const q = (j.quotes || []).filter(x => x.symbol && (x.longname || x.shortname));
  if (!q.length) return null;
  const pref = ['.MI', '.DE', '.F', '.AS', '.PA', '.SG', '.MU'];
  const rank = x => { if (x.symbol.toUpperCase() === c) return -1; const i = pref.findIndex(p => x.symbol.endsWith(p)); return i < 0 ? 50 : i; };
  q.sort((a, b) => rank(a) - rank(b));
  const x = q[0];
  return { nome: x.longname || x.shortname, tipo: tipoYahoo_(x.quoteType), ticker: x.symbol, borsa: x.exchDisp || x.exchange || '', fonte: 'Yahoo' };
}
function tipoYahoo_(t) {
  return { ETF: 'ETF', EQUITY: 'Azione', MUTUALFUND: 'Fondo', BOND: 'Obbligazione', MONEYMARKET: 'Monetario' }[String(t || '').toUpperCase()] || '';
}

/** Financial Times: buono per i fondi comuni che Yahoo non conosce. */
function infoFT_(isin) {
  const j = JSON.parse(scarica_('https://markets.ft.com/data/searchapi/searchsecurities?query=' + isin));
  const s = ((j.data && j.data.security) || []).find(x => x.name);
  if (!s) return null;
  const ac = String(s.assetClass || '');
  return { nome: s.name, tipo: /etf/i.test(ac) ? 'ETF' : /fund/i.test(ac) ? 'Fondo' : /equit/i.test(ac) ? 'Azione' : '', ticker: s.symbol || '', borsa: '', fonte: 'FT' };
}

/** OpenFIGI (Bloomberg): gratuita, senza chiave; copre anche molte obbligazioni. */
function infoFigi_(isin) {
  const r = UrlFetchApp.fetch('https://api.openfigi.com/v3/mapping', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin }]),
  });
  if (r.getResponseCode() !== 200) throw new Error('OpenFIGI ' + r.getResponseCode());
  const d = (JSON.parse(r.getContentText())[0] || {}).data || [];
  if (!d.length) return null;
  const x = d.find(y => /^(IM|GY|NA|FP|LN)$/.test(y.exchCode)) || d[0];
  const st = String(x.securityType2 || x.securityType || '') + ' ' + String(x.marketSector || '');
  return { nome: x.name, tipo: /etp|etf/i.test(st) ? 'ETF' : /fund/i.test(st) ? 'Fondo' : /corp|govt|bond|mtge/i.test(st) ? 'Obbligazione' : /equity|common/i.test(st) ? 'Azione' : '',
    ticker: x.ticker || '', borsa: x.exchCode || '', fonte: 'OpenFIGI' };
}

/** Toglie spazi doppi; se il nome è tutto maiuscolo (tipico di OpenFIGI) lo rende più leggibile. */
function pulisciNome_(n) {
  n = String(n).replace(/\s+/g, ' ').trim();
  if (n !== n.toUpperCase() || n.length < 6) return n;
  const sigle = /^(ETF|UCITS|MSCI|S&P|FTSE|USD|EUR|GBP|CHF|JPY|ACC|DIST|EM|ESG|SRI|USA|UK|EU|II|III|IV|SPA|SA|AG|NV|PLC|INC|AM|DWS|SPDR|BTP|BOT|CCT|BTF)$/;
  return n.split(' ').map(w => sigle.test(w.replace(/[(),.]/g, '')) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

/** Prova dall'editor: mostra cosa trova, senza scrivere nulla. */
function testInfoTitolo() {
  ['IE00B4L5Y983', 'LU0408877842', 'IT0005398406', 'US0378331005', 'SWDA.MI'].forEach(c => {
    try { console.log(c + ' → ' + JSON.stringify(infoTitolo_(c))); } catch (e) { console.log(c + ' → ERRORE ' + e.message); }
  });
}

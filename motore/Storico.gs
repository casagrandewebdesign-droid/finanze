/**
 * FINANZE APP — STORICO DEGLI INVESTIMENTI (file separato, va SOTTO "Prezzi")
 * - storicoInvestimento: andamento del prezzo da Yahoo Finance (per i titoli con ISIN/ticker)
 *   + i valori registrati nel tempo (tab "Storico investimenti", per tutti, anche il fondo pensione)
 * - ogni aggiornamento dei prezzi o modifica fatta dall'app salva una "foto" del giorno
 */
const STO = 'Storico investimenti';
const STO_HEAD = ['Data', 'Investimento', 'Prezzo', 'Quote', 'Valore'];

aggancia_({ storicoInvestimento: d => storicoInvestimento_(d.nome, d.periodo) });

(function () {
  if (typeof aggiornaPrezzi_ === 'function' && !aggiornaPrezzi_._v3) {
    const orig = aggiornaPrezzi_;
    aggiornaPrezzi_ = function (nome) { const r = orig(nome); try { fotografa_(nome); } catch (e) { console.warn(e); } return r; };
    aggiornaPrezzi_._v3 = true;
  }
  if (typeof updateInvestimento_ === 'function' && !updateInvestimento_._v3) {
    const orig = updateInvestimento_;
    updateInvestimento_ = function (d) { const r = orig(d); try { fotografa_(d.nome); } catch (e) { console.warn(e); } return r; };
    updateInvestimento_._v2 = true; updateInvestimento_._v3 = true;
  }
})();

/** Salva (o aggiorna) la riga di oggi per ogni investimento, o solo per "nome". */
function fotografa_(nome) {
  let sh = ss_().getSheetByName(STO);
  if (!sh) { sh = ss_().insertSheet(STO); sh.getRange(1, 1, 1, STO_HEAD.length).setValues([STO_HEAD]).setFontWeight('bold'); sh.setFrozenRows(1); }
  delete _mem['r_' + SHEETS.INV]; delete _mem['r_' + STO];
  const oggi = ymd_(new Date());
  const esist = rows_(STO).filter(r => ymd_(r['Data']) === oggi);
  rows_(SHEETS.INV).forEach(i => {
    if (nome && i['Nome'] !== nome) return;
    const q = num_(i['Quote']), p = num_(i['Prezzo']);
    const v = q && p ? round2_(q * p) : num_(i['Valore']);
    if (!v) return;
    const riga = [toDate_(oggi), i['Nome'], p || '', q || '', v];
    const e = esist.find(r => r['Investimento'] === i['Nome']);
    if (e) sh.getRange(e._row, 1, 1, riga.length).setValues([riga]);
    else sh.appendRow(riga);
  });
  delete _mem['r_' + STO];
}

/** periodo: 1m | 6m | 1a | 5a | max */
function storicoInvestimento_(nome, periodo) {
  const inv = rows_(SHEETS.INV).find(x => x['Nome'] === nome);
  if (!inv) throw new Error('Investimento non trovato');
  const per = { '1m': ['1mo', '1d', 31], '6m': ['6mo', '1d', 183], '1a': ['1y', '1d', 366], '5a': ['5y', '1wk', 1827], 'max': ['max', '1mo', 99999] }[periodo || '1a'] || ['1y', '1d', 366];
  const da = ymd_(new Date(Date.now() - per[2] * 864e5));
  // valori registrati (anche per chi non ha un prezzo pubblico)
  const valori = ss_().getSheetByName(STO) ? rows_(STO).filter(r => r['Investimento'] === nome)
    .map(r => ({ d: ymd_(r['Data']), v: num_(r['Valore']), p: num_(r['Prezzo']) || null }))
    .filter(x => x.d >= da).sort((a, b) => (a.d < b.d ? -1 : 1)) : [];
  // prezzi di mercato da Yahoo
  let prezzi = [], fonte = '', errore = '';
  const cod = String(inv[COL_COD] || '').trim().toUpperCase();
  if (cod) {
    try {
      let sym = (String(inv['Fonte prezzo'] || '').match(/^Yahoo (\S+)/) || [])[1];
      if (!sym) sym = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cod) ? yahooIsin_(cod).fonte.replace('Yahoo ', '') : cod;
      const key = 'sto_' + sym + '_' + per[0], cache = CacheService.getScriptCache(), c = cache.get(key);
      if (c) prezzi = JSON.parse(c);
      else {
        const j = JSON.parse(scarica_('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + per[0] + '&interval=' + per[1]));
        const r = j.chart.result[0], t = r.timestamp || [], cl = (r.indicators.quote[0] || {}).close || [];
        let k = r.meta.currency === 'GBp' ? 0.01 : 1;
        prezzi = t.map((s, n) => ({ d: Utilities.formatDate(new Date(s * 1000), TZ, 'yyyy-MM-dd'), p: cl[n] == null ? null : Math.round(cl[n] * k * 10000) / 10000 }))
          .filter(x => x.p != null);
        try { cache.put(key, JSON.stringify(prezzi), 6 * 3600); } catch (e) { }
      }
      fonte = 'Yahoo ' + sym;
    } catch (e) { errore = String(e.message || e); }
  }
  return { nome, periodo: periodo || '1a', prezzi, valori, fonte, errore };
}

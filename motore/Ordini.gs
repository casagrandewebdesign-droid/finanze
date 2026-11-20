/**
 * FINANZE APP — ORDINI: ACQUISTI E VENDITE (file separato, va in fondo all'elenco, SOTTO "Impostazioni")
 * ---------------------------------------------------------------------------
 * Estende la tab "Acquisti" con le colonne "Tipo" (Acquisto/Vendita) e "Commissioni".
 *   - Acquisto: Importo = totale pagato (quote × prezzo + commissioni), Quote positive
 *   - Vendita:  Importo negativo = incassato (quote × prezzo − commissioni), Quote negative
 * Versato e prezzo medio seguono il metodo del costo medio: una vendita toglie dal versato
 * la parte di costo delle quote vendute; la differenza è il guadagno "realizzato".
 * Azioni per l'app: addOrdine, updateOrdine (deleteAcquisto resta quella di Prezzi).
 * Si pubblica da solo con il deploy automatico (vedi DEPLOY.md).
 */
const ORD_EXTRA = ['Tipo', 'Commissioni'];

aggancia_({
  addOrdine: d => withLock_(() => addOrdine_(d)),
  updateOrdine: d => withLock_(() => updateOrdine_(d)),
});

function schemaOrdini_() {
  schema_();
  const sh = sh_(ACQ);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ORD_EXTRA.forEach(h => { if (head.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold'); });
  delete _mem['r_' + ACQ];
}
function setAcq_(row, col, v) {
  const sh = sh_(ACQ);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const c = head.indexOf(col);
  if (c >= 0) sh.getRange(row, c + 1).setValue(v);
}

// ============ lettura (sostituisce quella di Prezzi) ============
function acquisti_() {
  if (!ss_().getSheetByName(ACQ)) return [];
  return rows_(ACQ).map(a => {
    const q = num_(a['Quote']);
    const tipo = String(a['Tipo'] || '').toLowerCase().indexOf('vend') === 0 || q < 0 ? 'vendita' : 'acquisto';
    return {
      id: String(a['ID']), data: ymd_(a['Data']), investimento: a['Investimento'], tipo,
      importo: num_(a['Importo']), prezzo: num_(a['Prezzo']), quote: q, commissioni: num_(a['Commissioni']), note: a['Note'] || '',
    };
  }).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.tipo === 'acquisto' ? -1 : 1)));
}

/** Costo medio: le vendite tolgono dal versato il costo medio delle quote vendute. */
function riepilogoAcquisti_(lista, valore) {
  let quote = 0, costo = 0, realizzato = 0, nA = 0, nV = 0;
  const flows = [];
  lista.forEach(a => {
    if (a.tipo === 'vendita' || a.quote < 0) {
      const qv = Math.abs(a.quote), medio = quote ? costo / quote : 0, inc = Math.abs(a.importo);
      costo -= medio * qv; quote -= qv; realizzato += inc - medio * qv; nV++;
      flows.push({ d: toDate_(a.data), v: inc });
    } else {
      quote += a.quote; costo += a.importo; nA++;
      flows.push({ d: toDate_(a.data), v: -a.importo });
    }
  });
  if (quote < 1e-6) { quote = 0; costo = 0; }
  if (valore > 0) flows.push({ d: new Date(), v: valore });
  const x = xirr_(flows);
  return {
    n: lista.length, acquistiN: nA, venditeN: nV, quote, versato: round2_(costo),
    prezzoMedio: quote ? costo / quote : null, realizzato: nV ? round2_(realizzato) : null,
    primo: lista.length ? lista[0].data : '', ultimo: lista.length ? lista[lista.length - 1].data : '',
    annualizzato: x === null ? null : round2_(x * 100),
    acquisti: lista.slice(-120).reverse(),
  };
}

/** Ricalcola quote e versato dell'investimento dagli ordini (sostituisce quella di Prezzi). */
function ricalcola_(nome) {
  delete _mem['r_' + ACQ];
  const r = invRow_(nome);
  const p = num_(r['Prezzo']);
  const s = riepilogoAcquisti_(acquisti_().filter(a => a.investimento === nome), 0);
  setInv_(r, 'Quote', round6_(s.quote));
  setInv_(r, 'Versato', s.versato);
  if (p) setInv_(r, 'Valore', round2_(s.quote * p));
  setInv_(r, 'Aggiornato', new Date());
}

// ============ scrittura ============
/** d: { nome, tipo: 'acquisto'|'vendita', data, prezzo, quote?, commissioni?, importo?, note? } */
function calcolaOrdine_(d) {
  const vendita = String(d.tipo || '').toLowerCase().indexOf('vend') === 0;
  const prezzo = num_(d.prezzo), comm = Math.abs(num_(d.commissioni));
  let quote = Math.abs(num_(d.quote)), importo = Math.abs(num_(d.importo));
  if (!quote && importo && prezzo) quote = vendita ? (importo + comm) / prezzo : (importo - comm) / prezzo;
  if (!importo && quote && prezzo) importo = vendita ? quote * prezzo - comm : quote * prezzo + comm;
  if (!quote) throw new Error('Servono le quote, oppure il prezzo e l\'importo');
  if (!importo) throw new Error('Servono il prezzo o l\'importo');
  const p = prezzo || (vendita ? (importo + comm) / quote : (importo - comm) / quote);
  return { vendita, prezzo: p, comm, quote: round6_(quote), importo: round2_(importo) };
}

function addOrdine_(d) {
  schemaOrdini_();
  invRow_(d.nome);
  const o = calcolaOrdine_(d);
  if (o.vendita) {
    const posseduto = acquisti_().filter(a => a.investimento === d.nome).reduce((s, a) => s + a.quote, 0);
    if (o.quote > posseduto + 1e-6) throw new Error('Vendi più quote di quelle registrate (' + round6_(posseduto) + ')');
  }
  const sh = sh_(ACQ);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const id = Utilities.getUuid().slice(0, 8);
  const v = { 'ID': id, 'Data': toDate_(d.data || new Date()), 'Investimento': d.nome, 'Importo': o.vendita ? -o.importo : o.importo,
    'Prezzo': o.prezzo, 'Quote': o.vendita ? -o.quote : o.quote, 'Note': d.note || '', 'Creato': new Date(),
    'Tipo': o.vendita ? 'Vendita' : 'Acquisto', 'Commissioni': o.comm || '' };
  sh.appendRow(head.map(h => (v[h] !== undefined ? v[h] : '')));
  ricalcola_(d.nome);
  return { id };
}

function updateOrdine_(d) {
  schemaOrdini_();
  const a = rows_(ACQ).find(x => String(x['ID']) === String(d.id));
  if (!a) throw new Error('Ordine non trovato');
  const vecchio = acquisti_().find(x => x.id === String(d.id));
  const unito = {
    tipo: d.tipo !== undefined ? d.tipo : vecchio.tipo, data: d.data || vecchio.data,
    prezzo: d.prezzo !== undefined ? d.prezzo : vecchio.prezzo, quote: d.quote !== undefined ? d.quote : Math.abs(vecchio.quote),
    commissioni: d.commissioni !== undefined ? d.commissioni : vecchio.commissioni,
    importo: d.importo !== undefined ? d.importo : (d.quote !== undefined || d.prezzo !== undefined || d.commissioni !== undefined ? '' : Math.abs(vecchio.importo)),
  };
  const o = calcolaOrdine_(unito);
  setAcq_(a._row, 'Data', toDate_(unito.data));
  setAcq_(a._row, 'Importo', o.vendita ? -o.importo : o.importo);
  setAcq_(a._row, 'Prezzo', o.prezzo);
  setAcq_(a._row, 'Quote', o.vendita ? -o.quote : o.quote);
  setAcq_(a._row, 'Commissioni', o.comm || '');
  setAcq_(a._row, 'Tipo', o.vendita ? 'Vendita' : 'Acquisto');
  if (d.note !== undefined) setAcq_(a._row, 'Note', d.note);
  ricalcola_(a['Investimento']);
  return { id: d.id };
}

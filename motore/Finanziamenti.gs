/**
 * FINANZE APP — FINANZIAMENTI (file separato, va in fondo all'elenco, SOTTO "Impostazioni")
 * Legge la scheda "Finanziamenti" del database (una riga per finanziamento) e calcola
 * rate pagate, rate mancanti, debito residuo, prossima rata e data di fine.
 * Azione: "finanziamenti". Si pubblica da solo con il deploy automatico (vedi DEPLOY.md).
 *
 * Colonne usate: Nome, Tipo, Importo finanziato, Durata (mesi), Rata, Spese incasso,
 * Giorno addebito, Data attivazione, Data scadenza, TAN, Attivo, Note.
 * Le rate pagate si contano dalle date: ogni mese, il giorno di addebito, ne scatta una.
 */
const FIN = 'Finanziamenti';

aggancia_({ finanziamenti: () => finanziamenti_() });

function finanziamenti_() {
  const sh = ss_().getSheetByName(FIN);
  if (!sh || sh.getLastRow() < 2) return { lista: [], residuoTotale: 0, rataMensileTotale: 0 };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  const oggi = new Date(); oggi.setHours(23, 59, 59, 0);

  const lista = v.slice(1).filter(r => String(r[0]).trim()).map(r => {
    const g = k => r[head.indexOf(k)];
    const durata = Math.round(finNum_(g('Durata (mesi)')));
    const rata = finNum_(g('Rata')), spese = finNum_(g('Spese incasso'));
    const importo = finNum_(g('Importo finanziato')), tan = finNum_(g('TAN'));
    const attivo = !/^(no|n|false|0)$/i.test(String(g('Attivo') || 'sì').trim());
    const scad = finData_(g('Data scadenza'));
    let att = finData_(g('Data attivazione'));
    const giorno = Math.round(finNum_(g('Giorno addebito'))) || (scad ? scad.getDate() : 1);

    // date delle rate: l'ultima è la scadenza, le altre un mese prima ciascuna
    let prima = null;
    if (scad && durata) prima = finMese_(scad, -(durata - 1), giorno);
    else if (att && durata) prima = finMese_(att, 1, giorno);
    const scadenze = [];
    for (let k = 0; prima && k < durata; k++) scadenze.push(finMese_(prima, k, giorno));
    const pagate = attivo ? scadenze.filter(d => d <= oggi).length : durata;
    const mancanti = Math.max(0, durata - pagate);
    const prossima = scadenze[pagate] || null;

    // debito residuo = capitale ancora da restituire (piano alla francese con il TAN)
    let residuo;
    const i = tan > 1 ? tan / 1200 : tan / 12; // accetta "3,99%" o 0,0399
    if (rata && i > 0) residuo = rata * (1 - Math.pow(1 + i, -mancanti)) / i;
    else if (rata) residuo = rata * mancanti;
    else residuo = importo * mancanti / (durata || 1);
    residuo = Math.round(residuo * 100) / 100;

    return {
      nome: String(g('Nome')), tipo: String(g('Tipo') || ''), note: String(g('Note') || ''),
      attivo: attivo && mancanti > 0, importo, durata, rata, spese, rataTotale: rata + spese,
      tan: i * 1200, pagate, mancanti, residuo,
      daPagare: Math.round((rata + spese) * mancanti * 100) / 100,
      prossima: prossima ? ymd_(prossima) : '', fine: scadenze.length ? ymd_(scadenze[scadenze.length - 1]) : (scad ? ymd_(scad) : ''),
      inizio: prima ? ymd_(prima) : ''
    };
  });
  const attivi = lista.filter(f => f.attivo);
  return {
    lista,
    residuoTotale: Math.round(attivi.reduce((s, f) => s + f.residuo, 0) * 100) / 100,
    rataMensileTotale: Math.round(attivi.reduce((s, f) => s + f.rataTotale, 0) * 100) / 100
  };
}

function finNum_(x) {
  if (typeof x === 'number') return x;
  let s = String(x == null ? '' : x).replace(/[€%\s]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function finData_(x) {
  if (x instanceof Date && !isNaN(x)) return new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const s = String(x || '').trim(); let m;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
/** stesso giorno di addebito, n mesi dopo (o prima); se il mese è più corto usa l'ultimo giorno */
function finMese_(d, n, giorno) {
  const y = d.getFullYear(), mo = d.getMonth() + n;
  const ultimo = new Date(y, mo + 1, 0).getDate();
  return new Date(y, mo, Math.min(giorno, ultimo));
}

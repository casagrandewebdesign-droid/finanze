/**
 * FINANZE APP — EMAIL FIDEURAM (addebiti diretti, bonifici, prelievi) (file separato, va SOTTO "Isin")
 * Le email della banca arrivano su un'altra Gmail: lì gira un piccolo script ("Finanze - Lettore banca")
 * che manda il testo di ogni email qui, con l'azione "addebitoBanca". Niente inoltri di email.
 * Qui si legge il testo, si sceglie la categoria con le Regole e si registra il movimento.
 * Niente doppioni: l'id dell'email finisce nella colonna Fonte e viene controllato.
 */
// Arrivano le notifiche di due conti: si registrano solo quelle del conto che finisce così
const CONTO_BANCA = '341';

aggancia_({ addebitoBanca: d => withLock_(() => addebitoBanca_(d.testo || '', d.id || '')) });

const DATA_ = '(\\d{1,2})[./](\\d{1,2})[./](\\d{4})';
const EURO_ = '([0-9.]+,[0-9]{2}) ?(?:€|euro)';
function dataIso_(m, i) { return m[i + 2] + '-' + m[i + 1].padStart(2, '0') + '-' + m[i].padStart(2, '0'); }
function pulisciNome_(s) {
  return String(s).replace(/\s+(S\.?\s?a\.?\s?r\.?\s?l\.?|S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?l\.?|S\.?C\.?A\.?|et Cie|Ltd|GmbH|B\.?V\.?|SE)\b.*$/i, '').trim();
}

/**
 * Legge le email Fideuram. Tipi riconosciuti:
 * - Pagamento domiciliazione eseguito: "addebito diretto/domiciliazione di 13,50 € da parte di X … in data 25.11.2026 sul conto xxx341"
 * - Autorizzazione bonifico istantaneo/europeo: "in data 23.10.2026 … bonifico istantaneo di 159,00 € dal conto xxx081 a favore dell'IBAN IT***00762 [con data di addebito il 14.09.2026]"
 * - Inserimento Bonifico Europeo Unico: "in data 25/03/2026 … Bonifico Europeo Unico di 400,00 Euro dal conto xxx341 in favore dell'IBAN: LT***84035"
 * - Prelievo Cardless: "in data 03/10/2025 … Prelievo Cardless di 20,00 Euro sulla cassa veloce automatica di VIA CIPRO 4 A, ROMA" (non indica il conto)
 * Restituisce { importo, descrizione, data, conto } oppure null.
 */
function leggiBanca_(testo) {
  const t = String(testo).replace(/\s+/g, ' ');
  const conto = (t.match(/(?:sul|dal) conto\s+([^\s.,;]+)/i) || [])[1] || '';
  let m;
  if ((m = t.match(new RegExp('addebito diretto\\/?(?:domiciliazione)? di ' + EURO_ + ' da parte di (.+?) (?:è|e\') stato addebitato in data ' + DATA_, 'i')))) {
    return { importo: num_(m[1]), descrizione: pulisciNome_(m[2]) || m[2].trim(), data: dataIso_(m, 3), conto };
  }
  if ((m = t.match(new RegExp('in data ' + DATA_ + '.*?(?:autorizzato|inserito) un (bonifico[a-z ]*?) di ' + EURO_ + ' dal conto \\S+ (?:a|in) favore dell\'IBAN:? (\\S+?)[.,]?(?: |$)', 'i')))) {
    const add = t.match(new RegExp('data di addebito il ' + DATA_, 'i'));
    const tipo = m[4].trim().toLowerCase();
    return { importo: num_(m[5]), descrizione: (tipo.indexOf('istantaneo') > -1 ? 'Bonifico istantaneo' : 'Bonifico') + ' a ' + m[6],
      data: add ? dataIso_(add, 1) : dataIso_(m, 1), conto };
  }
  if ((m = t.match(new RegExp('in data ' + DATA_ + '.*?eseguito un prelievo[a-z ]*? di ' + EURO_ + '(?: (?:sulla|presso) .*? di (.+?)\\.(?: |$))?', 'i')))) {
    return { importo: num_(m[4]), descrizione: 'Prelievo' + (m[5] ? ' ' + m[5].trim() : ''), data: dataIso_(m, 1), conto };
  }
  return null;
}

function addebitoBanca_(testo, id) {
  const a = leggiBanca_(testo);
  if (!a || !a.importo) return { saltato: 'email non riconosciuta' };
  // conto indicato e diverso da xxx341 → altro conto; i prelievi non indicano il conto e vengono registrati
  if (a.conto && !a.conto.endsWith(CONTO_BANCA)) return { saltato: 'altro conto (' + a.conto + ')' };
  if (id && usaAsset_() && assetSheet_().getRange('F:F').getValues().some(r => String(r[0]).indexOf(id) > -1)) {
    return { saltato: 'già registrato' };
  }
  const categoria = categorizza_(a.descrizione);
  return addMovimento_({
    data: a.data, importo: a.importo, segno: 'uscita', categoria, descrizione: a.descrizione,
    fonte: 'Banca' + (id ? ' · ' + id : '') + (categoria ? '' : ' · DA VERIFICARE'),
  });
}

/** Prova dall'editor (non scrive niente) */
function testAddebito() {
  console.log(JSON.stringify(leggiBanca_("Gentile Cliente, ti informiamo che l'addebito diretto/domiciliazione di 13,50 € da parte di PayPal Europe S.a.r.l. et Cie S.C.A è stato addebitato in data 25.11.2026 sul conto xxx341.")));
}

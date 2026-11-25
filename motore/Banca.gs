/**
 * FINANZE APP — ADDEBITI DIRETTI FIDEURAM (file separato, va SOTTO "Isin")
 * Le email della banca arrivano su un'altra Gmail: lì gira un piccolo script ("Finanze - Lettore banca")
 * che manda il testo di ogni email qui, con l'azione "addebitoBanca". Niente inoltri di email.
 * Qui si legge il testo, si sceglie la categoria con le Regole e si registra il movimento.
 * Niente doppioni: l'id dell'email finisce nella colonna Fonte e viene controllato.
 */
// Arrivano le notifiche di due conti: si registrano solo quelle del conto che finisce così
const CONTO_BANCA = '341';

aggancia_({ addebitoBanca: d => withLock_(() => addebitoBanca_(d.testo || '', d.id || '')) });

/** "…l'addebito diretto/domiciliazione di 13,50 € da parte di PayPal Europe S.a.r.l. et Cie S.C.A è stato addebitato in data 25.11.2026…" */
function leggiAddebito_(testo) {
  const t = String(testo).replace(/\s+/g, ' ');
  const m = t.match(/addebito diretto\/?(?:domiciliazione)? di ([0-9.]+,[0-9]{2}) ?(?:€|eur\w*) da parte di (.+?) (?:è|e') stato addebitato in data (\d{1,2})[./](\d{1,2})[./](\d{4})/i);
  if (!m) return null;
  const conto = (t.match(/sul conto\s+([^\s.,;]+)/i) || [])[1] || '';
  if (!conto.endsWith(CONTO_BANCA)) return { altroConto: conto || '?' };
  const chi = m[2].replace(/\s+(S\.?\s?a\.?\s?r\.?\s?l\.?|S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?l\.?|S\.?C\.?A\.?|et Cie|Ltd|GmbH|B\.?V\.?|SE)\b.*$/i, '').trim();
  return { importo: num_(m[1]), descrizione: chi || m[2].trim(), data: m[5] + '-' + m[4].padStart(2, '0') + '-' + m[3].padStart(2, '0') };
}

function addebitoBanca_(testo, id) {
  const a = leggiAddebito_(testo);
  if (a && a.altroConto) return { saltato: 'altro conto (' + a.altroConto + ')' };
  if (!a || !a.importo) return { saltato: 'non è un addebito diretto' };
  if (id && usaAsset_() && assetSheet_().getRange('F:F').getValues().some(r => String(r[0]).indexOf(id) > -1)) {
    return { saltato: 'già registrato' };
  }
  const categoria = categorizza_(a.descrizione);
  return addMovimento_({
    data: a.data, importo: a.importo, segno: 'uscita', categoria, descrizione: a.descrizione,
    fonte: 'Addebito diretto' + (id ? ' · ' + id : '') + (categoria ? '' : ' · DA VERIFICARE'),
  });
}

/** Prova dall'editor (non scrive niente) */
function testAddebito() {
  console.log(JSON.stringify(leggiAddebito_("Gentile Cliente, ti informiamo che l'addebito diretto/domiciliazione di 13,50 € da parte di PayPal Europe S.a.r.l. et Cie S.C.A è stato addebitato in data 25.11.2026 sul conto xxx341.")));
}

/**
 * FINANZE APP — INVIO SICURO DALLA CODA OFFLINE (va dopo Aggancio nell'ordine)
 * ---------------------------------------------------------------------------
 * L'app dà a ogni movimento nuovo un codice "cid". Se la stessa richiesta arriva
 * due volte (rete instabile: il motore ha salvato ma la risposta si è persa e
 * l'app riprova dalla coda), la seconda volta non si crea un doppione: si
 * risponde con il movimento già salvato.
 */
aggancia_({
  addMovimento: d => {
    const cache = CacheService.getScriptCache();
    const chiave = d.cid ? 'cid_' + String(d.cid).slice(0, 40) : '';
    const mov = withLock_(() => {
      if (chiave) {
        const gia = cache.get(chiave);
        if (gia) { const m = JSON.parse(gia); m.doppione = true; return m; }
      }
      const m = addMovimento_(d);
      if (chiave) cache.put(chiave, JSON.stringify(m), 21600);   // ricorda per 6 ore
      return m;
    });
    return conInit_(mov, d._mese);
  },
});

# Deploy automatico

Dopo questa configurazione basta fare commit su GitHub:

- **Motore** (file in `motore/`): il workflow *Deploy motore* carica i file nel progetto Apps Script, crea una nuova versione e la assegna **al deployment esistente**. L'URL `/exec` resta lo stesso, quindi non devi più toccare l'app.
- **App** (index.html, sw.js…): il workflow *Deploy app* pubblica su GitHub Pages e scrive da solo il numero di versione. Non devi più aggiornare a mano `VERSIONE` e `finanze-vNN`.

## Configurazione (una volta sola, circa 10 minuti)

1. **Attiva l'API di Apps Script**: apri https://script.google.com/home/usersettings e metti su *On* "Google Apps Script API".
2. **Fai il login Google per GitHub**. Sul repo premi *Code → Codespaces → Create codespace*, poi nel terminale:
   ```
   npx @google/clasp@2.4.2 login --no-localhost
   ```
   Apri il link, accedi con l'account del motore, copia l'URL a cui vieni mandato e incollalo nel terminale. Poi:
   ```
   cat ~/.clasprc.json
   ```
   Copia tutto il testo che compare. Dopo puoi eliminare il Codespace.
3. **Aggiungi 3 secret** in *Settings → Secrets and variables → Actions → New repository secret*:
   - `CLASPRC_JSON`: il testo copiato al punto 2
   - `SCRIPT_ID`: Apps Script → ⚙️ *Impostazioni progetto* → *ID script*
   - `DEPLOYMENT_ID`: la parte dell'URL del motore tra `/s/` e `/exec`
4. **GitHub Pages**: in *Settings → Pages → Source* scegli **GitHub Actions**.
5. **Prova**: *Actions → Deploy motore → Run workflow* con la spunta su "Solo prova". Nel log trovi l'ordine dei file e cosa verrebbe aggiornato, senza che venga scritto nulla.

## Come funziona il deploy del motore

- I file presenti solo nel progetto Apps Script (per esempio `Codice.gs`) **restano come sono**: vengono aggiornati solo quelli che esistono anche in `motore/`.
- L'ordine dei file nel progetto non cambia. I file nuovi vanno dove dice `motore/ordine.txt` (per esempio `Aggancio` subito sotto `Codice`).
- Prima di ogni deploy, il progetto com'era viene salvato come artifact *backup-motore* nella pagina del workflow, e lì resta per 30 giorni.
- Se un file `.gs` ha un errore di sintassi, il deploy si ferma prima di pubblicare.
- Se il motore non cambia, non viene creata nessuna versione nuova.

## Aggiungere un'azione al motore

In un file di `motore/` basta una riga:
```js
aggancia_({ nomeAzione: d => withLock_(() => miaFunzione_(d)) });
```
Il token, la gestione degli errori e la risposta JSON li gestisce `Aggancio.gs`.

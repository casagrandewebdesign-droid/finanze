# Finanze — mappa per Claude (leggi questo prima di esplorare)

App personale di Federico: PWA su GitHub Pages + motore Google Apps Script che usa un foglio Google come database.
Rispondi in italiano. Le istruzioni manuali vanno date in chat, pronte da copiare.

## Dove sta cosa
| Cosa | Dove |
|---|---|
| App (tutto in un file: HTML+CSS+JS) | `index.html` (~1650 righe, ~136 KB) — NON leggerlo intero: usa `grep -n "/\* ====="` e leggi solo la sezione che serve |
| Service worker | `sw.js` (cache-first + aggiornamento in background; `__BUILD__` lo scrive il deploy) |
| Mappa del mondo (sezione Paesi) | `world.json` 113 KB — non leggerlo mai |
| Motore Apps Script | `motore/*.gs` (Codice.gs = core: router doGet/doPost, letture, scritture, SMS, Asset) |
| Ordine dei file in Apps Script | `motore/ordine.txt` |
| Deploy | `.github/workflows/motore.yml`, `.github/workflows/app.yml`, `tools/deploy-motore.mjs`, `DEPLOY.md` |

Sezioni di `index.html` (cerca il titolo): Stato & config · API · Caricamento · Render · Spese per categoria · Confronti spese · Ripartizione · Paesi · Obiettivo · Da dove viene la crescita · Form nuovo movimento · Patrimonio · Finanziamenti · Navigazione · Modalità demo · Avvio · Blocco Face ID.
Viste: `v-home`, `v-mov`, `v-pat`, `v-inv`, `v-cfr`, `v-set`.

## Deploy (automatico, non fare mai deploy a mano)
- Push su `main` → `motore/**` va in Apps Script (nuova versione sullo **stesso** deployment, URL invariato); il resto va su GitHub Pages con il numero di versione scritto in automatico.
- Non aggiornare a mano `VERSIONE` (index.html) né il nome della cache (sw.js): restano `__BUILD__`.
- Prova del motore senza scrivere: Actions → Deploy motore → Run workflow → "Solo prova".
- I file che esistono solo in Apps Script vengono copiati nel repo dal workflow (es. Codice.gs): fai `git pull` prima di modificarli.
- Secrets: `CLASPRC_JSON` (login Google, lo gestisce Federico), `SCRIPT_ID`, `DEPLOYMENT_ID`.

## Motore: come si aggiunge un'azione
In un file `motore/*.gs` (sotto Aggancio nell'ordine):
```js
aggancia_({ nomeAzione: d => withLock_(() => miaFunzione_(d)) });   // withLock_ solo se scrive
```
Token, errori e risposta JSON li fa `Aggancio.gs`. Nell'app: `api('nomeAzione', {}, {dati})` (POST) o `api('nomeAzione', {param})` (GET).
Aggiungi anche il caso in `demoApi()` (Modalità demo) per non rompere la demo.
Helper del core: `ss_()`, `sh_(nome)`, `rows_(nome)` (con `_row`), `_mem` (cache per richiesta: cancella `_mem['r_'+foglio]` dopo le scritture), `num_`, `ymd_`, `toDate_`, `round2_`, `SHEETS`, `PROPS`, `TZ`.
Nota: `Ordini.gs` ridefinisce `acquisti_`, `riepilogoAcquisti_`, `ricalcola_` di `Prezzi.gs` (vince l'ultimo file).

## Riferimenti (non segreti)
- Apps Script "Finanze App - Motore": script ID `1pRCHnBGJRZT3FOzOgm2prt9jYmVo-3Jj--UdU6FoXmlP8tGkXzl4RhgR`
- Deployment: `AKfycby0iJ3dbJyR_Vp8Rl2L6qH5aevKX42JnUYs48bwup3xOFY0zJ0m1nT4UYZ6bNVV6t5VPA`
- Sito: https://casagrandewebdesign-droid.github.io/finanze/
- Repo gemello: `casagrandewebdesign-droid/bollette` (app Bollette, stessa struttura)

## Per lavorare in fretta
- Verifica sintassi: `for f in motore/*.gs; do cp $f /tmp/x.js; node --check /tmp/x.js; done`
- Test dell'app: apri il sito nel browser e usa `api(...)` dalla console (le funzioni sono globali); senza URL/token l'app va in modalità demo.
- Non serve aprire l'editor di Apps Script: tutto il codice è nel repo.

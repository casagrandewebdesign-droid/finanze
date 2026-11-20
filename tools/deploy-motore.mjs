// Pubblica il motore (cartella motore/) nel progetto Apps Script e aggiorna il deployment esistente,
// così l'URL /exec usato dall'app non cambia mai.
//
// Variabili richieste: CLASPRC_JSON (contenuto di ~/.clasprc.json), SCRIPT_ID, DEPLOYMENT_ID
// Facoltative: DRY_RUN=1 (mostra cosa farebbe senza scrivere), DESCRIZIONE (testo della versione)
//
// Cosa fa:
// 1. scarica i file attuali del progetto e li salva in backup/ (copia di sicurezza)
// 2. sostituisce i file che esistono anche nel repo, lascia intatti quelli che non ci sono (es. Codice.gs)
// 3. mantiene l'ordine dei file del progetto; i file nuovi vanno dove dice motore/ordine.txt
// 4. crea una nuova versione e la assegna al deployment esistente
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const DIR = 'motore';
const { CLASPRC_JSON, SCRIPT_ID, DEPLOYMENT_ID, DRY_RUN, DESCRIZIONE } = process.env;
if (!CLASPRC_JSON || !SCRIPT_ID || !DEPLOYMENT_ID) throw new Error('Mancano i secret CLASPRC_JSON, SCRIPT_ID o DEPLOYMENT_ID');
const API = 'https://script.googleapis.com/v1/projects/' + SCRIPT_ID;

async function accessToken() {
  const rc = JSON.parse(CLASPRC_JSON);
  const tok = rc.token || (rc.tokens && rc.tokens.default) || rc;
  const cli = rc.oauth2ClientSettings || {};
  const body = new URLSearchParams({
    client_id: cli.clientId || tok.client_id, client_secret: cli.clientSecret || tok.client_secret,
    refresh_token: tok.refresh_token, grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Login Google non valido: rifai "clasp login" e aggiorna CLASPRC_JSON (' + JSON.stringify(j) + ')');
  return j.access_token;
}

async function call(token, method, url, body) {
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || r.statusText;
    if (/has not been used|is disabled|User has not enabled the Apps Script API/i.test(msg))
      throw new Error('Attiva "Google Apps Script API" su https://script.google.com/home/usersettings e riprova.');
    throw new Error(method + ' ' + url + ' → ' + r.status + ': ' + msg);
  }
  return j;
}

// file locali: Nome.gs → { name: 'Nome', type: 'SERVER_JS' }
function fileLocali() {
  return readdirSync(DIR).filter(f => ['.gs', '.js', '.html'].includes(extname(f)) || f === 'appsscript.json').map(f => {
    const ext = extname(f), name = basename(f, ext);
    const type = ext === '.html' ? 'HTML' : ext === '.json' ? 'JSON' : 'SERVER_JS';
    return { name, type, source: readFileSync(join(DIR, f), 'utf8') };
  });
}

function ordina(remoti, locali) {
  const ordine = existsSync(join(DIR, 'ordine.txt'))
    ? readFileSync(join(DIR, 'ordine.txt'), 'utf8').split('\n').map(s => s.replace(/#.*/, '').trim().replace(/\.gs$/, '')).filter(Boolean)
    : [];
  const key = f => f.name + '|' + f.type;
  const loc = new Map(locali.map(f => [key(f), f]));
  // 1. file del progetto, nel loro ordine, con il contenuto del repo se c'è
  const out = remoti.map(f => loc.has(key(f)) ? { ...f, source: loc.get(key(f)).source, _agg: true } : f);
  const presenti = new Set(out.map(key));
  // 2. file nuovi: subito dopo il file che li precede in ordine.txt
  const nuovi = locali.filter(f => !presenti.has(key(f)));
  nuovi.sort((a, b) => (ordine.indexOf(a.name) + 1 || 1e9) - (ordine.indexOf(b.name) + 1 || 1e9));
  for (const f of nuovi) {
    const pos = ordine.indexOf(f.name);
    let dopo = -1;
    for (let i = pos - 1; pos > 0 && i >= 0 && dopo < 0; i--) dopo = out.findIndex(x => x.name === ordine[i] && x.type === 'SERVER_JS');
    const n = { ...f, _nuovo: true };
    if (pos < 0) out.push(n); else out.splice(dopo + 1, 0, n);
  }
  return out;
}

const token = await accessToken();
const remoti = (await call(token, 'GET', API + '/content')).files || [];
mkdirSync('backup', { recursive: true });
writeFileSync('backup/progetto-prima-del-deploy.json', JSON.stringify(remoti, null, 2));

// salva nel repo i file che esistono solo nel progetto (es. Codice.gs): così il repo ha sempre tutto il motore
for (const f of remoti) {
  const nome = f.name + (f.type === 'SERVER_JS' ? '.gs' : f.type === 'HTML' ? '.html' : '');
  if (f.type === 'JSON' || existsSync(join(DIR, nome))) continue;
  writeFileSync(join(DIR, nome), f.source); console.log('Salvato nel repo: motore/' + nome);
}
const files = ordina(remoti, fileLocali());
const cambiati = files.filter(f => f._nuovo || (f._agg && remoti.find(r => r.name === f.name && r.type === f.type).source !== f.source));
console.log('Ordine dei file nel progetto:');
files.forEach((f, i) => console.log(String(i + 1).padStart(3), f.name + (f.type === 'SERVER_JS' ? '.gs' : f.type === 'HTML' ? '.html' : '.json'),
  f._nuovo ? '(nuovo)' : cambiati.includes(f) ? '(aggiornato)' : f._agg ? '(uguale)' : '(solo nel progetto, lasciato com\'è)'));

if (!cambiati.length) { console.log('\nNessuna modifica al motore: niente da pubblicare.'); process.exit(0); }
if (DRY_RUN === '1' || DRY_RUN === 'true') { console.log('\nProva (DRY_RUN): non ho scritto nulla.'); process.exit(0); }

const pulito = files.map(({ name, type, source }) => ({ name, type, source }));
await call(token, 'PUT', API + '/content', { files: pulito });
const descr = (DESCRIZIONE || 'Deploy automatico').slice(0, 300);
const ver = await call(token, 'POST', API + '/versions', { description: descr });
await call(token, 'PUT', API + '/deployments/' + DEPLOYMENT_ID, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: descr },
});
console.log('\nPubblicata la versione ' + ver.versionNumber + ' sul deployment esistente (stesso URL).');

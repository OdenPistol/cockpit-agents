import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { Cockpit } from '../src/cockpit.js';
import { lireJour } from '../src/journal.js';
import { demarrerServeur } from '../src/serveur.js';
import { jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, nettoyer } from './aide.js';

const ouverts = [];
after(async () => {
  for (const fin of ouverts) await fin();
});

async function demarrer(agents = { alpha: agentMd({ budget: 5 }) }, config = {}) {
  const racine = creerProjet(agents);
  const cfg = configTest(config);
  const cockpit = new Cockpit({ racine, config: cfg });
  await cockpit.initialiser();
  const serveur = await demarrerServeur({ cockpit, config: cfg, racine, intervalleEtatMs: 150 });
  const base = `http://127.0.0.1:${serveur.port}`;
  const fin = async () => {
    await cockpit.arreter();
    await serveur.fermer();
    nettoyer(racine);
  };
  ouverts.push(fin);
  return { racine, cockpit, serveur, base, port: serveur.port };
}

/** Lecteur de Server-Sent Events : garde tout ce qui arrive, avec l'heure d'arrivée. */
function ouvrirSSE(base) {
  const ctrl = new AbortController();
  const recus = [];
  const attentes = [];
  let tampon = '';
  const traiter = (bloc) => {
    const evenement = /^event: (.*)$/m.exec(bloc)?.[1];
    const data = /^data: (.*)$/m.exec(bloc)?.[1];
    if (!evenement || !data) return;
    const e = { evenement, donnees: JSON.parse(data), t: Date.now() };
    recus.push(e);
    for (const a of [...attentes]) {
      if (a.predicat(e)) {
        attentes.splice(attentes.indexOf(a), 1);
        clearTimeout(a.minuteur);
        a.resolve(e);
      }
    }
  };
  const pret = fetch(`${base}/api/evenements`, { signal: ctrl.signal }).then((reponse) => {
    const decodeur = new TextDecoder();
    const lecteur = reponse.body.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          tampon += decodeur.decode(value, { stream: true });
          let i = tampon.indexOf('\n\n');
          while (i >= 0) {
            traiter(tampon.slice(0, i));
            tampon = tampon.slice(i + 2);
            i = tampon.indexOf('\n\n');
          }
        }
      } catch {
        // fermé par le test
      }
    })();
    return reponse;
  });
  return {
    recus,
    pret,
    attendre(predicat, delai = 10000) {
      const deja = recus.find(predicat);
      if (deja) return Promise.resolve(deja);
      return new Promise((resolve, reject) => {
        const minuteur = setTimeout(() => reject(new Error(`événement attendu non reçu. Reçus : ${recus.map((r) => `${r.evenement}:${r.donnees.texte ?? ''}`).join(' | ')}`)), delai);
        attentes.push({ predicat, resolve, minuteur });
      });
    },
    fermer() {
      ctrl.abort();
    },
  };
}

const requete = (port, chemin, { methode = 'GET', entetes = {} } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: entetes }, (res) => {
    let corps = '';
    res.on('data', (c) => { corps += c; });
    res.on('end', () => resolve({ statut: res.statusCode, entetes: res.headers, corps }));
  });
  r.on('error', reject);
  r.end();
});

describe('pages et API', () => {
  it('sert l\'écran, ses fichiers, et refuse le reste', async () => {
    const { base } = await demarrer();
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Cockpit d'agents<\/title>/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    for (const f of ['style.css', 'app.js', 'favicon.svg']) assert.equal((await fetch(`${base}/${f}`)).status, 200, f);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/config.json`)).status, 404);
  });

  it('/api/etat donne les agents, le coût du jour et les alertes', async () => {
    const { base } = await demarrer({ alpha: agentMd({ nom: 'Alpha', budget: 5 }), beta: agentMd({ nom: 'Beta', budget: 1 }) });
    const etat = await (await fetch(`${base}/api/etat`)).json();
    assert.deepEqual(etat.agents.map((a) => a.nom), ['Alpha', 'Beta']);
    assert.equal(etat.cout.jour_eur, 0);
    assert.equal(etat.cout.plafond_eur, 3);
    assert.equal(etat.cout.reste_eur, 3);
    assert.equal(etat.cout.estime_eur, 0);
    assert.equal(etat.cout.equivalent_api, true);
    assert.deepEqual(etat.alertes, []);
    assert.deepEqual(etat.claude, { ok: true, version: '2.1.999', connecte: true });
  });

  it('un agent ajouté en créant un dossier apparaît au rechargement suivant', async () => {
    const { base, racine } = await demarrer();
    assert.equal((await (await fetch(`${base}/api/etat`)).json()).agents.length, 1);
    fs.mkdirSync(path.join(racine, 'agents', 'nouveau'));
    fs.writeFileSync(path.join(racine, 'agents', 'nouveau', 'agent.md'), agentMd({ nom: 'Nouveau' }));
    const etat = await (await fetch(`${base}/api/etat`)).json();
    assert.deepEqual(etat.agents.map((a) => a.nom), ['Agent de test', 'Nouveau']);
  });
});

describe('protections locales', () => {
  it('refuse un en-tête Host qui n\'est pas local (DNS rebinding)', async () => {
    const { port } = await demarrer();
    const r = await requete(port, '/api/etat', { entetes: { Host: 'pirate.example' } });
    assert.equal(r.statut, 403);
    const ok = await requete(port, '/api/etat', { entetes: { Host: `localhost:${port}` } });
    assert.equal(ok.statut, 200);
  });

  it('refuse un lancement sans l\'en-tête X-Cockpit ou depuis une autre origine (requête venue d\'une autre page web)', async () => {
    const { port, cockpit } = await demarrer();
    const sans = await requete(port, '/api/agents/alpha/lancer', { methode: 'POST' });
    assert.equal(sans.statut, 403);
    const etrangere = await requete(port, '/api/agents/alpha/lancer', { methode: 'POST', entetes: { 'X-Cockpit': '1', Origin: 'https://pirate.example' } });
    assert.equal(etrangere.statut, 403);
    const nulle = await requete(port, '/api/agents/alpha/lancer', { methode: 'POST', entetes: { 'X-Cockpit': '1', Origin: 'null' } });
    assert.equal(nulle.statut, 403);
    assert.equal(cockpit.enCours.size, 0, 'aucun passage lancé');
  });

  it('agent inconnu : 404 ; identifiant tordu : 404', async () => {
    const { port } = await demarrer();
    const e = { 'X-Cockpit': '1' };
    assert.equal((await requete(port, '/api/agents/fantome/lancer', { methode: 'POST', entetes: e })).statut, 404);
    assert.equal((await requete(port, '/api/agents/..%2F..%2Fetc/lancer', { methode: 'POST', entetes: e })).statut, 404);
  });

  it('les résultats sont servis en texte brut sandboxé, et personne ne sort du dossier out/', async () => {
    const { port, racine } = await demarrer();
    fs.mkdirSync(path.join(racine, 'out', 'alpha'));
    fs.writeFileSync(path.join(racine, 'out', 'alpha', 'page.md'), '<script>alert(1)</script>\n# Titre');
    fs.symlinkSync(path.join(racine, 'data', 'lisez-moi.txt'), path.join(racine, 'out', 'alpha', 'lien.txt'));
    const ok = await requete(port, '/out/alpha/page.md');
    assert.equal(ok.statut, 200);
    assert.match(ok.entetes['content-type'], /^text\/plain/);
    assert.match(ok.entetes['content-security-policy'], /sandbox/);
    assert.equal(ok.entetes['x-content-type-options'], 'nosniff');
    // Le parseur d'URL normalise lui-même « %2e%2e » : la requête ne vise plus out/, c'est un 404, jamais un fichier.
    for (const tordu of ['/out/%2e%2e/journal/x', '/out/alpha/%2e%2e/%2e%2e/package.json', '/out/../package.json']) {
      const r = await requete(port, tordu);
      assert.equal(r.statut, 404, tordu);
      assert.ok(!r.corps.includes('cockpit-agents'), `le contenu de package.json ne doit pas sortir (${tordu})`);
    }
    // « %2f » atteint notre propre contrôle des segments.
    assert.equal((await requete(port, '/out/..%2f..%2fpackage.json')).statut, 400);
    assert.equal((await requete(port, '/out/alpha%2f..%2f..%2fjournal')).statut, 400);
    assert.equal((await requete(port, '/out/alpha/lien.txt')).statut, 404, 'un lien symbolique vers l\'extérieur n\'est pas suivi');
    assert.equal((await requete(port, '/out/alpha/nexiste-pas.md')).statut, 404);
  });
});

describe('lancement depuis l\'écran, journal en direct', () => {
  it('le journal arrive ligne par ligne pendant le passage (pas d\'un bloc à la fin), puis l\'état final porte le vrai coût', async () => {
    const { base, racine } = await demarrer({ alpha: agentMd({ nom: 'Alpha', budget: 5 }) }, {});
    const flux = ouvrirSSE(base);
    await flux.pret;
    await flux.attendre((e) => e.evenement === 'etat');

    process.env.FAKE_CLAUDE = 'lent';
    process.env.FAKE_COUT = '0.1';
    try {
      const reponse = await fetch(`${base}/api/agents/alpha/lancer`, { method: 'POST', headers: { 'X-Cockpit': '1' } });
      assert.equal(reponse.status, 202);
      const lecture = await flux.attendre((e) => e.evenement === 'ligne' && e.donnees.texte === 'Lit data/lisez-moi.txt');
      const fin = await flux.attendre((e) => e.evenement === 'ligne' && /^Terminé en/.test(e.donnees.texte));
      assert.ok(fin.t - lecture.t >= 400, `les lignes doivent arriver au fil de l'eau (écart ${fin.t - lecture.t} ms)`);
      assert.equal(lecture.donnees.agent, 'alpha');
      assert.equal(lecture.donnees.niveau, 'action');

      // pendant le passage, l'état dit « en cours » ; à la fin, « réussi » avec le coût converti
      await flux.attendre((e) => e.evenement === 'etat' && e.donnees.agents[0].statut === 'en_cours');
      const final = await flux.attendre((e) => e.evenement === 'etat' && e.donnees.agents[0].statut === 'reussi');
      assert.equal(final.donnees.agents[0].cout_jour_eur, 0.086);
      assert.equal(final.donnees.cout.jour_eur, 0.086);
      assert.equal(final.donnees.historique[0].resultat, 'out/alpha/resultat.md');
    } finally {
      delete process.env.FAKE_CLAUDE;
      delete process.env.FAKE_COUT;
      flux.fermer();
    }

    const journal = lireJour(path.join(racine, 'journal'), jourLocal(new Date()));
    assert.equal(journal.length, 1);
    assert.equal(journal[0].cout_eur, 0.086);
    assert.equal(journal[0].statut, 'reussi');
  });

  it('un client qui se connecte après le début reçoit le rejeu des dernières lignes', async () => {
    const { base, cockpit } = await demarrer();
    await cockpit.lancer('alpha').promesse;
    const flux = ouvrirSSE(base);
    await flux.pret;
    const rejeu = await flux.attendre((e) => e.evenement === 'ligne' && e.donnees.rejeu === true && /^Terminé/.test(e.donnees.texte));
    assert.ok(rejeu);
    flux.fermer();
  });

  it('budget dépassé via l\'écran : réponse 409 qui dit pourquoi, alerte diffusée, aucun processus lancé', async () => {
    const { base, cockpit } = await demarrer({ alpha: agentMd({ budget: 0.01 }) }, { estimation_defaut_eur: 0.15 });
    const flux = ouvrirSSE(base);
    await flux.pret;
    await flux.attendre((e) => e.evenement === 'etat');
    const reponse = await fetch(`${base}/api/agents/alpha/lancer`, { method: 'POST', headers: { 'X-Cockpit': '1' } });
    assert.equal(reponse.status, 409);
    const corps = await reponse.json();
    assert.equal(corps.code, 'budget');
    assert.match(corps.message, /^Agent de test non lancé : il dépasserait son budget du jour/);
    assert.match(corps.conseil, /^Relève le budget de « Agent de test »/, 'la bulle commence par un verbe');
    const alerte = await flux.attendre((e) => e.evenement === 'etat' && e.donnees.alertes.some((a) => a.type === 'budget'));
    assert.equal(alerte.donnees.agents[0].statut, 'bloque_budget');
    assert.equal(cockpit.enCours.size, 0);
    flux.fermer();
  });

  it('un second lancement pendant un passage est refusé (409)', async () => {
    const { base, cockpit } = await demarrer();
    process.env.FAKE_CLAUDE = 'lent';
    try {
      const premier = await fetch(`${base}/api/agents/alpha/lancer`, { method: 'POST', headers: { 'X-Cockpit': '1' } });
      assert.equal(premier.status, 202);
      const second = await fetch(`${base}/api/agents/alpha/lancer`, { method: 'POST', headers: { 'X-Cockpit': '1' } });
      assert.equal(second.status, 409);
      assert.equal((await second.json()).code, 'deja_en_cours');
      await cockpit.enCours.get('alpha').promesse;
    } finally {
      delete process.env.FAKE_CLAUDE;
    }
  });
});

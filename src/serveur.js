// Serveur web local (modules natifs, aucune dépendance).
//   GET  /                          l'écran du cockpit (dossier public/)
//   GET  /api/etat                  l'état complet en JSON
//   GET  /api/evenements            flux Server-Sent Events : « etat » (état complet) et « ligne » (journal en direct)
//   POST /api/agents/<id>/lancer    lance un agent (refusé si le budget ou un autre passage l'interdit)
//   GET  /out/<agent>/<fichier>     ouvre un résultat en texte brut
//
// Protections, sans authentification (c'est un outil local) :
//   - le serveur n'écoute que sur 127.0.0.1 ;
//   - l'en-tête Host doit être localhost / 127.0.0.1 (contre le « DNS rebinding ») ;
//   - un lancement exige l'en-tête X-Cockpit et refuse toute origine étrangère (contre les requêtes
//     envoyées par une autre page web ouverte dans le navigateur) ;
//   - les résultats sont servis en texte brut, jamais interprétés comme du HTML.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const FICHIERS_PUBLICS = new Set(['index.html', 'style.css', 'app.js', 'favicon.svg']);
const TEXTE_BRUT = new Set(['.md', '.txt', '.csv', '.json', '.jsonl', '.log']);
const HOTES_AUTORISES = new Set(['localhost', '127.0.0.1', '[::1]']);

const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const CSP_PAGE = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function nomHote(valeur) {
  if (!valeur) return '';
  if (valeur.startsWith('[')) return valeur.slice(0, valeur.indexOf(']') + 1);
  return valeur.split(':')[0];
}

function repondreJson(res, statut, objet) {
  const corps = JSON.stringify(objet);
  res.writeHead(statut, {
    ...ENTETES_SECURITE,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(corps),
  });
  res.end(corps);
}

/**
 * Démarre le serveur web.
 * @param {{cockpit: import('./cockpit.js').Cockpit, config: object, racine: string, intervalleEtatMs?: number}} p
 * @returns {Promise<{serveur: http.Server, port: number, fermer: () => Promise<void>}>}
 */
export function demarrerServeur({ cockpit, config, racine, intervalleEtatMs = 5000 }) {
  const dossierPublic = path.join(racine, 'public');
  const dossierOut = path.join(racine, 'out');
  const clients = new Set();
  let dernierEtat = '';

  const envoyer = (res, evenement, donnees) => {
    res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`);
  };
  const diffuser = (evenement, donnees) => {
    for (const res of clients) envoyer(res, evenement, donnees);
  };
  const diffuserEtat = (force = false) => {
    if (clients.size === 0) return;
    const etat = cockpit.etat();
    const texte = JSON.stringify(etat);
    if (!force && texte === dernierEtat) return;
    dernierEtat = texte;
    diffuser('etat', etat);
  };

  cockpit.on('ligne', (l) => diffuser('ligne', l));
  let envoiPrevu = null;
  cockpit.on('changement', () => {
    if (envoiPrevu) return;
    envoiPrevu = setTimeout(() => {
      envoiPrevu = null;
      diffuserEtat();
    }, 40);
  });
  const horloge = setInterval(() => diffuserEtat(), intervalleEtatMs);
  const battement = setInterval(() => {
    for (const res of clients) res.write(': battement\n\n');
  }, 15000);

  const servirFichierPublic = (res, nom) => {
    if (!FICHIERS_PUBLICS.has(nom)) return repondreJson(res, 404, { ok: false, message: 'Page introuvable.' });
    let contenu;
    try {
      contenu = fs.readFileSync(path.join(dossierPublic, nom));
    } catch {
      return repondreJson(res, 404, { ok: false, message: 'Page introuvable.' });
    }
    res.writeHead(200, {
      ...ENTETES_SECURITE,
      'Content-Type': TYPES[path.extname(nom)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP_PAGE,
      'Cache-Control': 'no-cache',
      'Content-Length': contenu.length,
    });
    return res.end(contenu);
  };

  const servirResultat = (res, chemin) => {
    const segments = decodeURIComponent(chemin.slice('/out/'.length)).split('/').filter((s) => s !== '');
    if (segments.length === 0 || segments.some((s) => s === '..' || s === '.' || s.includes('\0') || s.includes('\\'))) {
      return repondreJson(res, 400, { ok: false, message: 'Chemin refusé.' });
    }
    let fichier;
    try {
      fichier = fs.realpathSync(path.join(dossierOut, ...segments));
      const racineOut = fs.realpathSync(dossierOut);
      if (!fichier.startsWith(`${racineOut}${path.sep}`) || !fs.statSync(fichier).isFile()) throw new Error('hors du dossier');
    } catch {
      return repondreJson(res, 404, { ok: false, message: 'Résultat introuvable.' });
    }
    const extension = path.extname(fichier).toLowerCase();
    const contenu = fs.readFileSync(fichier);
    res.writeHead(200, {
      ...ENTETES_SECURITE,
      'Content-Type': TEXTE_BRUT.has(extension) ? 'text/plain; charset=utf-8' : 'application/octet-stream',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-store',
      'Content-Length': contenu.length,
      ...(TEXTE_BRUT.has(extension) ? {} : { 'Content-Disposition': 'attachment' }),
    });
    return res.end(contenu);
  };

  const serveur = http.createServer((req, res) => {
    try {
      if (!HOTES_AUTORISES.has(nomHote(req.headers.host))) {
        return repondreJson(res, 403, { ok: false, message: 'Hôte refusé : ce cockpit ne répond qu\'à localhost.' });
      }
      const url = new URL(req.url, 'http://localhost');
      const chemin = url.pathname;

      if (req.method === 'GET' && chemin === '/') return servirFichierPublic(res, 'index.html');
      if (req.method === 'GET' && chemin.startsWith('/out/')) return servirResultat(res, chemin);
      if (req.method === 'GET' && chemin === '/api/etat') return repondreJson(res, 200, cockpit.etat());

      if (req.method === 'GET' && chemin === '/api/evenements') {
        res.writeHead(200, {
          ...ENTETES_SECURITE,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        const etat = cockpit.etat();
        envoyer(res, 'etat', etat);
        for (const l of cockpit.lignes) envoyer(res, 'ligne', { ...l, rejeu: true });
        return undefined;
      }

      const lancement = /^\/api\/agents\/([a-z0-9-]+)\/lancer$/.exec(chemin);
      if (req.method === 'POST' && lancement) {
        if (req.headers['x-cockpit'] !== '1') {
          return repondreJson(res, 403, { ok: false, message: 'Requête refusée : en-tête X-Cockpit manquant.' });
        }
        const origine = req.headers.origin;
        if (origine && !HOTES_AUTORISES.has(nomHote(origine.replace(/^https?:\/\//, '')))) {
          return repondreJson(res, 403, { ok: false, message: 'Requête refusée : origine étrangère.' });
        }
        req.resume();
        const r = cockpit.lancer(lancement[1], 'manuel');
        if (r.ok) return repondreJson(res, 202, { ok: true, agent: lancement[1] });
        const statut = r.code === 'inconnu' ? 404 : r.code === 'agent_invalide' ? 422 : 409;
        return repondreJson(res, statut, { ok: false, code: r.code, message: r.message, conseil: r.conseil });
      }

      if (req.method === 'GET' && FICHIERS_PUBLICS.has(chemin.slice(1))) return servirFichierPublic(res, chemin.slice(1));
      return repondreJson(res, 404, { ok: false, message: 'Page introuvable.' });
    } catch (e) {
      return repondreJson(res, 500, { ok: false, message: `Erreur interne : ${e.message}` });
    }
  });

  return new Promise((resolve, reject) => {
    serveur.once('error', (e) => {
      clearInterval(horloge);
      clearInterval(battement);
      reject(e.code === 'EADDRINUSE'
        ? new Error(`Le port ${config.port} est déjà utilisé : le cockpit tourne peut-être déjà. Ouvre http://127.0.0.1:${config.port} ou change « port » dans config.json.`)
        : e);
    });
    serveur.listen(config.port, '127.0.0.1', () => {
      const { port } = serveur.address();
      resolve({
        serveur,
        port,
        fermer: () => new Promise((fin) => {
          clearInterval(horloge);
          clearInterval(battement);
          clearTimeout(envoiPrevu);
          for (const res of clients) res.end();
          clients.clear();
          serveur.close(() => fin());
          serveur.closeAllConnections?.();
        }),
      });
    });
  });
}

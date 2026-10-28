// Contrôle des données et des agents livrés dans le dépôt : tout est fictif, aucune marque ni
// organisation réelle, aucun chemin personnel dans les fichiers du projet.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chargerAgents } from '../src/agent-md.js';
import { chargerConfig } from '../src/config.js';
import { RACINE_REELLE, TUTOIEMENT } from './aide.js';

const config = chargerConfig(RACINE_REELLE);
const lire = (...p) => fs.readFileSync(path.join(RACINE_REELLE, ...p), 'utf8');

// ROT13 : réversible, sans accent ni clé. Sert à ne pas écrire en clair, dans le dépôt, des noms réels à interdire.
const rot13 = (texte) => texte.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

// Marques, organismes et services réels : interdits dans les données de démonstration.
const MARQUES_REELLES = [
  'linkedin', 'urssaf', 'orange', 'sfr', 'bouygues', 'free.fr', 'laposte', 'la poste', 'amazon', 'google', 'gmail', 'microsoft', 'outlook',
  'hotmail', 'yahoo', 'wanadoo', 'paypal', 'stripe', 'qonto', 'shopify', 'notion', 'zoom', 'slack', 'apple', 'icloud', 'facebook', 'whatsapp',
  'instagram', 'twitter', 'tiktok', 'youtube', 'doctolib', 'ameli', 'cpam', 'impots.gouv', 'dgfip', 'gouv.fr', 'france travail', 'pôle emploi',
  'bnp', 'société générale', 'crédit agricole', 'caisse d\'épargne', 'boursorama', 'revolut', 'vinted', 'leboncoin', 'sncf', 'air france',
  'uber', 'airbnb', 'booking', 'canva', 'dropbox', 'ovh', 'vercel', 'anthropic', 'claude', 'openai', 'chatgpt', 'cegid', 'pennylane', 'malt',
  'mailchimp', 'hubspot', 'salesforce', 'zapier', 'airtable', 'trello', 'cnil', 'insee', 'banque de france', 'axa', 'maif', 'macif', 'chronopost',
  'colissimo', 'dhl', 'fedex', 'docusign', 'calendly', 'github', 'mastercard', 'cdiscount', 'fnac', 'carrefour', 'leclerc', 'netflix', 'spotify',
  // Relevés par la relecture : un réseau de colis, une enseigne de magasins, un cabinet d'avocats et un service de mobilité bien réels
  // (le dernier par précaution : le nom avait été inventé).
  // Écrits en ROT13 pour que le dépôt lui-même ne les contienne pas en clair.
  ...['erynvf pbyvf', 'unzryva', 'hyznaa', 'zbovylf'].map(rot13),
];
// Un chemin absolu du dossier personnel révélerait le nom de l'utilisateur de la machine.
const CHEMINS_PERSONNELS = [/\/(?:users|home)\/[^/\s]+/gi];

function trouver(texte, mots) {
  const t = ` ${texte.toLowerCase()} `;
  const motifs = mots.filter((m) => m instanceof RegExp);
  const trouves = motifs.flatMap((re) => t.match(re) ?? []).map((x) => x.trim());
  return [...trouves, ...mots.filter((m) => typeof m === 'string').filter((m) => {
    if (/[ .'/@]/.test(m)) return t.includes(m);
    return new RegExp(`(?<![a-zà-ÿ0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zà-ÿ0-9])`).test(t);
  })];
}

// Tous les fichiers texte du projet (sans dépendre de git : un dossier téléchargé en ZIP n'a pas de .git).
// Les dossiers remplis par l'exécution (journal, out) et les images sont laissés de côté.
function fichiersDuDepot(dossier = '') {
  const fichiers = [];
  for (const entree of fs.readdirSync(path.join(RACINE_REELLE, dossier), { withFileTypes: true })) {
    const relatif = path.posix.join(dossier, entree.name);
    // .git : le dossier de git, ou, dans un worktree, un fichier qui renvoie vers lui (il contient un chemin absolu)
    if (entree.name === '.git') continue;
    if (entree.isDirectory()) {
      // .claude : réglages locaux de l'outil de développement, ignorés par git et jamais publiés
      if (['.git', '.claude', 'node_modules', 'journal', 'out'].includes(entree.name)) continue;
      fichiers.push(...fichiersDuDepot(relatif));
    } else if (!/\.(png|jpg|ico)$/i.test(entree.name) && entree.name !== '.DS_Store') {
      fichiers.push(relatif);
    }
  }
  return fichiers;
}

describe('les 9 agents livrés', () => {
  const { agents, invalides } = chargerAgents(RACINE_REELLE, config.ordre);

  it('sont tous lisibles, dans l\'ordre de config.json', () => {
    assert.deepEqual(invalides, []);
    assert.deepEqual(agents.map((a) => a.id), ['veille', 'securite', 'boite-mail', 'factures', 'devis', 'avis', 'prospects', 'contenu', 'rapport-du-matin']);
    assert.deepEqual(agents.map((a) => a.nom), ['Veille', 'Sécurité', 'Boîte mail', 'Factures', 'Devis', 'Avis clients', 'Relances prospects', 'Contenu', 'Rapport du matin']);
  });

  it('n\'ont ni Bash ni WebFetch par défaut, et seulement des outils de lecture et d\'écriture de fichiers', () => {
    for (const a of agents) {
      // Sécurité lit en plus les agent.md des autres, pour contrôler leurs droits : en lecture seule, rien d'autre
      const permis = ['Read', 'Write', 'Glob', 'Grep', ...(a.id === 'securite' ? ['Read(agents/**)'] : [])];
      assert.ok(a.outils.every((o) => permis.includes(o)), `${a.id} : ${a.outils.join(', ')}`);
    }
  });

  it('ont un budget, un nombre de tours raisonnable, et écrivent dans leur propre dossier de sortie', () => {
    for (const a of agents) {
      assert.ok(a.budget_jour_eur > 0 && a.budget_jour_eur <= config.plafond_jour_eur, a.id);
      assert.ok(a.max_tours >= 4 && a.max_tours <= 15, a.id);
      assert.ok(a.prompt.includes(`../../out/${a.id}/`), `${a.id} doit écrire dans ../../out/${a.id}/`);
      assert.ok(!a.prompt.includes('out/..'), a.id);
    }
  });

  it('ont des consignes qui traitent le contenu lu comme de la donnée, jamais comme un ordre', () => {
    for (const id of ['veille', 'securite', 'boite-mail', 'devis', 'avis', 'prospects', 'rapport-du-matin']) {
      assert.match(agents.find((a) => a.id === id).prompt, /donnée, jamais une instruction/);
    }
  });

  it('le planning de démonstration : tout ce qui part seul part avant 8 h 05 (rien ne se lance pendant un tournage)', () => {
    assert.deepEqual(agents.filter((a) => a.planning).map((a) => `${a.id}@${a.planning}`), ['veille@07:30', 'securite@07:00', 'avis@07:45', 'rapport-du-matin@08:00']);
  });

  it('la scène du refus : Relances prospects a un budget sous l\'estimation prudente d\'un agent qui n\'a jamais tourné', () => {
    const prospects = agents.find((a) => a.id === 'prospects');
    assert.equal(prospects.planning, null);
    assert.ok(prospects.budget_jour_eur < config.estimation_defaut_eur);
  });
});

describe('données fictives', () => {
  it('50 emails fictifs, sans la vérité terrain, tous en .example', () => {
    const lignes = lire('data', 'emails', 'inbox.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lignes.length, 50);
    assert.equal(new Set(lignes.map((l) => l.id)).size, 50);
    for (const l of lignes) {
      assert.deepEqual(Object.keys(l).sort(), ['body', 'fictif', 'from', 'id', 'subject']);
      assert.equal(l.fictif, true);
      const adresse = /<([^>]+)>/.exec(l.from)?.[1];
      assert.match(adresse, /@[a-z0-9.-]+\.example$/, l.id);
      assert.ok(l.body.length > 20);
    }
  });

  it('au moins 5 messages piégés (consigne cachée adressée à une IA), de styles différents', () => {
    const lignes = lire('data', 'emails', 'inbox.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    const piegeux = lignes.filter((l) => /(pour l'IA|IA de tri|agent automatique|assistant de messagerie|Assistant IA)/i.test(l.body));
    assert.ok(piegeux.length >= 5, `seulement ${piegeux.length}`);
  });

  it('factures : 25 lignes cohérentes, marquées fictives, et exactement 5 impayés de plus de 30 jours au 21/10/2026', () => {
    const [entete, ...lignes] = lire('data', 'factures', 'factures.csv').trim().split('\n');
    assert.equal(entete, 'numero;client;prestation;date_emission;date_echeance;montant_ht;tva;montant_ttc;statut;date_paiement;fictif');
    assert.equal(lignes.length, 25);
    const ref = new Date(2026, 9, 21);
    const nombre = (s) => Number(s.replace(',', '.'));
    let aRelancer = 0;
    let exactement30 = 0;
    for (const l of lignes) {
      const [numero, , , , echeance, ht, tva, ttc, statut, paiement, fictif] = l.split(';');
      assert.equal(fictif, 'oui', numero);
      assert.ok(Math.abs(nombre(ttc) - (nombre(ht) + nombre(tva))) < 0.005, numero);
      assert.ok(Math.abs(nombre(tva) - nombre(ht) * 0.2) < 0.005, numero);
      assert.equal(statut === 'payée', paiement !== '', `${numero} : payée <=> date de paiement`);
      const [a, m, j] = echeance.split('-').map(Number);
      const retard = Math.round((ref - new Date(a, m - 1, j)) / 86400000);
      if (statut === 'impayée' && retard > 30) aRelancer += 1;
      if (statut === 'impayée' && retard === 30) exactement30 += 1;
    }
    assert.equal(aRelancer, 5);
    assert.equal(exactement30, 1, 'un cas limite à 30 jours pile est présent pour vérifier la règle « plus de 30 »');
  });

  it('veille et notes : chaque fichier se déclare fictif', () => {
    const extraits = fs.readdirSync(path.join(RACINE_REELLE, 'data', 'veille', 'extraits'));
    assert.equal(extraits.length, 6);
    for (const f of extraits) assert.match(lire('data', 'veille', 'extraits', f), /^> Extrait fictif/, f);
    for (const f of fs.readdirSync(path.join(RACINE_REELLE, 'data', 'notes'))) assert.match(lire('data', 'notes', f).split('\n')[0], /fictive/i, f);
    assert.match(lire('data', 'veille', 'sources.md'), /Données fictives/);
    assert.match(lire('data', 'LISEZMOI.md'), /Tout ce dossier est fictif/);
  });

  it('aucune marque, aucun organisme ni service réel dans data/, dans les consignes des agents ni dans les sorties d\'exemple', () => {
    const cibles = fichiersDuDepot().filter((f) => f.startsWith('data/') || (f.startsWith('docs/exemples-de-sorties/') && f.endsWith('.md')) || /^agents\/.*\.md$/.test(f));
    assert.ok(cibles.length >= 20, `${cibles.length} fichiers`);
    for (const f of cibles) {
      const trouves = trouver(lire(f), MARQUES_REELLES);
      assert.deepEqual(trouves, [], `${f} mentionne : ${trouves.join(', ')}`);
    }
  });
});

describe('style : aucun tiret cadratin ni demi-cadratin, nulle part', () => {
  it('ni dans l\'écran, la console, les consignes, les données, le README, ni dans les sorties d\'exemple', () => {
    const fichiers = fichiersDuDepot();
    assert.ok(fichiers.length > 50);
    for (const f of fichiers) {
      const trouves = lire(f).match(/[\u2013\u2014]/g);
      assert.equal(trouves, null, `${f} contient ${trouves?.length} tiret(s) cadratin ou demi-cadratin`);
    }
  });

  it('chaque agent.md impose la règle, sans écrire lui-même ces tirets', () => {
    for (const a of chargerAgents(RACINE_REELLE, config.ordre).agents) {
      assert.match(a.prompt, /aucun tiret cadratin ni demi-cadratin/, a.id);
    }
  });
});

describe('style : tutoiement dans tout ce qui s\'adresse à la personne qui installe et utilise', () => {
  const VOUVOIEMENT = /\b(vous|votre|vos)\b|\b(ajoutez|créez|mettez|remplacez|copiez|lancez|tapez|glissez|ouvrez|installez|regardez|rechargez|retirez|changez|relancez|récupérez|cliquez|appuyez|vérifiez|faites|lisez|consultez|attendez|patientez|choisissez|saisissez|modifiez|supprimez|activez|désactivez|démarrez|arrêtez|fermez|utilisez|pouvez|devez|voulez|autorisez|gardez|donnez|écrivez|indiquez|précisez|vérifiez|relancez|déplacez|renommez)\b/i;

  it('le détecteur fonctionne dans les deux sens', () => {
    assert.match('Ajoutez ceci à votre dossier', VOUVOIEMENT);
    assert.match('quand vous l\'arrêtez', VOUVOIEMENT);
    assert.doesNotMatch('Ajoute ceci à ton dossier, tu peux relancer', VOUVOIEMENT);
  });

  it('messages, écran, console, modèle de lancement, en-têtes et notes des agents, notes du dossier data (les deux README vouvoient, voir plus bas)', () => {
    const cibles = fichiersDuDepot().filter((f) => (
      f === 'server.js' || f === 'data/LISEZMOI.md' || f === 'data/veille/sources.md'
      || f.startsWith('src/') || f.startsWith('scripts/') || f.startsWith('exemples/')
      || (f.startsWith('public/') && /\.(html|js|css)$/.test(f))
    ));
    assert.ok(cibles.length >= 20, `${cibles.length} fichiers`);
    for (const f of cibles) {
      const m = lire(f).match(VOUVOIEMENT);
      assert.equal(m, null, `${f} vouvoie : « ${m?.[0]} »`);
    }
    for (const a of chargerAgents(RACINE_REELLE, config.ordre).agents) {
      const brut = lire('agents', a.id, 'agent.md');
      const entete = brut.slice(0, brut.indexOf('\n---', 4));
      assert.doesNotMatch(entete, VOUVOIEMENT, `agents/${a.id}/agent.md (en-tête)`);
    }
  });
});

describe('style : vouvoiement dans les deux README (le reste du projet tutoie)', () => {
  it('le détecteur de tutoiement fonctionne dans les deux sens', () => {
    for (const phrase of [
      'Ouvre ton navigateur', 'Si tu veux, tape `cd`', 'Tu peux relancer', 'Il faut que tu cliques', 'Pour revenir à la tienne',
      'Récupère le dossier', '1. Ouvre l\'application Terminal', '- Tape la commande', 'Pour l\'arrêter, appuie sur Ctrl+C', 'rien ne t\'est demandé',
    ]) assert.match(phrase, TUTOIEMENT, phrase);
    for (const phrase of [
      'Ouvrez votre navigateur', 'Si vous voulez, tapez `cd`', 'Vous pouvez relancer', 'Pour revenir à la vôtre',
      'Un clic sur la ligne d\'un agent ouvre sa fiche', 'Un cockpit local qui lance des agents', 'elle se ferme seule quand un passage démarre',
      'Sécurité relève les outils de chaque agent', 'Le cockpit s\'ouvre dans votre navigateur', 'Contenu | transforme vos notes en brouillon',
    ]) assert.doesNotMatch(phrase, TUTOIEMENT, phrase);
  });

  it('README.md et docs/README-complet.md vouvoient, sans aucun tutoiement', () => {
    for (const f of ['README.md', 'docs/README-complet.md']) {
      const texte = lire(f);
      assert.doesNotMatch(texte, TUTOIEMENT, `${f} tutoie : « ${TUTOIEMENT.exec(texte)?.[0]} »`);
      assert.match(texte, /\b(vous|votre|vos)\b/i, `${f} ne vouvoie pas`);
    }
  });
});

describe('style : accord en nombre, jamais « (s) » ni un pluriel en dur derrière un nombre', () => {
  const NOMS_COMPTES = 'outils|tours|agents|passages|caractères|fichiers|lignes|jours|messages|alertes|erreurs|essais|étapes|jetons|tentatives|factures|infos|spams|brouillons|impayés|illisibles';

  it('le détecteur fonctionne dans les deux sens', () => {
    const pluriel = new RegExp(`\\$\\{[^}]*\\}\\s+(${NOMS_COMPTES})\\b`);
    assert.match('texte: `${n} outils`', pluriel);
    assert.match('texte: `${evenement.tools.length} outils`', pluriel);
    assert.doesNotMatch('texte: `${compte(n, \'outil\')}`', pluriel);
    assert.match('6 message(s) piégé(s)', /[a-zéèêàâîôû]{4,}\((s|es)\)/);
    assert.doesNotMatch('console.log(s)', /[a-zéèêàâîôû]{4,}\((s|es)\)/);
  });

  it('src/ et public/app.js : tous les compteurs passent par compte() ou plurielSi()', () => {
    const cibles = fichiersDuDepot().filter((f) => (f.startsWith('src/') && f.endsWith('.js')) || f === 'public/app.js' || f === 'server.js' || f.startsWith('scripts/'));
    assert.ok(cibles.length >= 15, `${cibles.length} fichiers`);
    const pluriel = new RegExp(`\\$\\{[^}]*\\}\\s+(${NOMS_COMPTES})\\b`, 'g');
    for (const f of cibles) {
      const m = lire(f).match(pluriel);
      assert.equal(m, null, `${f} met un pluriel en dur : ${m}`);
    }
  });

  it('aucun « (s) » : ni dans le code, ni dans les consignes des agents, le README, les données et les sorties d\'exemple', () => {
    const cibles = fichiersDuDepot().filter((f) => (
      (f.startsWith('src/') && f.endsWith('.js')) || f === 'public/app.js' || f === 'public/index.html' || f === 'README.md' || f === 'docs/README-complet.md'
      || /^agents\/.*\.md$/.test(f) || f.startsWith('data/') || (f.startsWith('docs/exemples-de-sorties/') && f.endsWith('.md'))
    ));
    for (const f of cibles) {
      const m = lire(f).match(/[a-zéèêàâîôû]{4,}\((s|es)\)/g);
      assert.equal(m, null, `${f} : ${m}`);
    }
  });

  it('la consigne de Boîte mail demande l\'accord du bilan', () => {
    const consigne = lire('agents', 'boite-mail', 'agent.md');
    assert.match(consigne, /N messages piégés/);
    assert.match(consigne, /Accorde chaque nom avec N/);
    assert.match(consigne, /« 1 message piégé »/);
  });

  it('le bilan de la sortie d\'exemple de Boîte mail est accordé', () => {
    const bilan = lire('docs', 'exemples-de-sorties', 'tri-2026-10-21.md').split('\n').find((l) => /à traiter/.test(l) && /·/.test(l));
    assert.ok(bilan, 'ligne de bilan introuvable');
    const parties = [...bilan.matchAll(/(\d+) (factures?|infos?|spams?|messages? piégés?)/g)];
    assert.ok(parties.length >= 4, bilan);
    for (const [, n, mots] of parties) {
      const pluriel = Number(n) >= 2;
      for (const mot of mots.split(' ')) assert.equal(mot.endsWith('s'), pluriel, `« ${n} ${mots} » mal accordé dans : ${bilan}`);
    }
  });
});

describe('aucune trace personnelle dans le dépôt', () => {
  it('le détecteur fonctionne dans les deux sens (il trouve ce qu\'il doit trouver, et laisse passer le reste)', () => {
    assert.deepEqual(trouver(`/${'Users'}/quelquun/projet`, CHEMINS_PERSONNELS), [`/${'users'}/quelquun`]);
    assert.deepEqual(trouver('lancer depuis ~/cockpit-agents ou $HOME', CHEMINS_PERSONNELS), []);
    assert.deepEqual(trouver('Consultant à Lyon, atelier Verdelet', MARQUES_REELLES), []);
    assert.deepEqual(trouver('Mon compte LinkedIn et mon gmail', MARQUES_REELLES).sort(), ['gmail', 'linkedin']);
    for (const [phrase, nom] of [['Erynvf Pbyvf Rkcerff', 'erynvf pbyvf'], ['Znteleaf Unzryva', 'unzryva'], ['Pnovarg Hyznaa', 'hyznaa'], ['Zbovylf Erpv', 'zbovylf']]) {
      assert.deepEqual(trouver(rot13(phrase), MARQUES_REELLES), [rot13(nom)], `${nom} (ROT13) doit être détecté`);
    }
    assert.deepEqual(trouver('Colivia Express, Boutiques Fauriel, Cabinet Delorge', MARQUES_REELLES), [], 'les noms inventés passent');
    assert.deepEqual(trouver('Une orangeraie et un zoom sur la carte, mais pas le service', ['orange']), [], 'pas de faux positif sur un mot qui en contient un autre');
  });

  it('aucun fichier du dépôt (suivi ou non, hors dossiers produits à l\'exécution) ne contient de chemin personnel', () => {
    for (const f of fichiersDuDepot()) {
      if (f === 'test/donnees.test.js') continue; // contient la liste des motifs recherchés
      const trouves = trouver(lire(f), CHEMINS_PERSONNELS);
      assert.deepEqual(trouves, [], `${f} contient : ${trouves.join(', ')}`);
    }
  });

  it('la licence porte le nom public du créateur', () => {
    assert.match(lire('LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 Cédric Oden\n/);
  });
});

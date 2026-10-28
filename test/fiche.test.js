// La fiche d'un agent : elle s'ouvre au clic sur sa ligne (jamais sur « Lancer »), montre ce qui est déjà dans l'état,
// sans rien calculer, et se ferme à la croix, à Échap, ou quand un passage démarre.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { construireEtat } from '../src/etat.js';
import { isoLocal } from '../src/utilitaires.js';
import { configTest, RACINE_REELLE } from './aide.js';

const lire = (nom) => fs.readFileSync(path.join(RACINE_REELLE, 'public', nom), 'utf8');
const html = lire('index.html');
const js = lire('app.js');
const css = lire('style.css');

// app.js ne peut rien importer : on en extrait contenuFiche et on la fait tourner avec des mises en forme témoins,
// qui écrivent chaque valeur telle quelle (on voit ainsi d'où vient chaque nombre affiché).
const source = /function contenuFiche\([^)]*\) \{[\s\S]*?\n\}\n/.exec(js)?.[0];
const contenuFiche = source ? new Function(`${source}\nreturn contenuFiche;`)() : null;
const TEMOINS = {
  eur: (x) => `[eur ${x}]`,
  duree: (ms) => `[duree ${ms}]`,
  quand: (iso) => `[quand ${iso}]`,
  cout: (x) => `[cout ${x}]`,
  statut: (s) => `[statut ${s}]`,
};
const agent = (surcharges = {}) => ({
  id: 'veille',
  nom: 'Veille',
  description: 'Résume l\'actu IA du jour',
  planning: '07:30',
  statut: 'reussi',
  fait: '3 sujets à retenir',
  budget_jour_eur: 0.4,
  cout_jour_eur: 0.065,
  dernier_passage: '2026-10-28T13:40:07+01:00',
  dernier_debut: '2026-10-28T13:39:43+01:00',
  dernier_duree_ms: 24000,
  dernier_cout_eur: 0.065,
  dernier_statut: 'reussi',
  dernier_resultat: 'out/veille/veille-2026-10-28.md',
  ...surcharges,
});

describe('fiche d\'un agent : le contenu', () => {
  it('la fonction est bien dans app.js', () => {
    assert.ok(contenuFiche, 'contenuFiche introuvable dans app.js');
  });

  it('le déclenchement : « Automatique à 07:30 » ou « Manuel »', () => {
    assert.equal(contenuFiche(agent(), TEMOINS).declenchement, 'Automatique à 07:30');
    assert.equal(contenuFiche(agent({ planning: null }), TEMOINS).declenchement, 'Manuel');
  });

  it('description, budget du jour, dernier passage et résultat viennent de l\'état, tels quels', () => {
    const c = contenuFiche(agent(), TEMOINS);
    assert.equal(c.nom, 'Veille');
    assert.equal(c.description, 'Résume l\'actu IA du jour');
    assert.equal(c.budget, '[eur 0.065] dépensés aujourd\'hui, sur [eur 0.4]');
    assert.equal(c.dernier, '[quand 2026-10-28T13:40:07+01:00] · [duree 24000] · [cout 0.065] · [statut reussi]');
    assert.equal(c.resultat, '3 sujets à retenir');
    assert.equal(c.peutOuvrir, true);
  });

  it('jamais lancé, échec, rien aujourd\'hui : un texte clair, sans bouton « Ouvrir le résultat » s\'il n\'y a pas de fichier', () => {
    const jamais = contenuFiche(agent({ fait: null, dernier_passage: null, dernier_statut: null, dernier_resultat: null }), TEMOINS);
    assert.equal(jamais.dernier, 'jamais lancé');
    assert.equal(jamais.resultat, 'Rien aujourd\'hui pour l\'instant.');
    assert.equal(jamais.peutOuvrir, false);
    const echec = contenuFiche(agent({ fait: null, dernier_statut: 'echec', dernier_resultat: null }), TEMOINS);
    assert.match(echec.resultat, /a échoué/);
  });

  it('aucun chiffre calculé : chaque nombre affiché est une valeur de l\'état', () => {
    const a = agent();
    const valeurs = new Set(Object.values(a).flatMap((v) => String(v).match(/\d+(?:\.\d+)?/g) ?? []));
    for (const texte of Object.values(contenuFiche(a, TEMOINS)).filter((v) => typeof v === 'string')) {
      for (const n of texte.match(/\d+(?:\.\d+)?/g) ?? []) assert.ok(valeurs.has(n), `« ${n} » n'est pas dans l'état : ${texte}`);
    }
  });
});

describe('fiche d\'un agent : ouverture et fermeture', () => {
  it('la page a la fiche, cachée au départ, avec une croix, « Ouvrir le résultat » et « Lancer »', () => {
    assert.match(html, /<aside class="fiche" id="fiche"[^>]*hidden>/);
    assert.match(html, /id="fiche-fermer" aria-label="Fermer la fiche"/);
    assert.match(html, /id="fiche-ouvrir"[^>]*>Ouvrir le résultat</);
    assert.match(html, /id="fiche-lancer">Lancer</);
    assert.ok(html.indexOf('id="fiche"') > html.indexOf('<main class="poste">') && html.indexOf('id="fiche"') < html.indexOf('</main>'), 'la fiche est dans le poste');
  });

  it('un clic sur la ligne ouvre la fiche, jamais un clic sur « Lancer »', () => {
    assert.match(js, /li\.addEventListener\('click', \(evenement\) => \{\n\s+if \(evenement\.target\.closest\('\.lancer'\)\) return;\n\s+ouvrirFiche\(li\.dataset\.id\);/);
  });

  it('Échap ferme d\'abord le lecteur, puis la fiche ; la croix la ferme', () => {
    assert.match(js, /if \(!\$\('lecteur'\)\.hidden\) fermerResultat\(\);\n\s+else if \(ficheId !== null\) fermerFiche\(\);/);
    assert.match(js, /\$\('fiche-fermer'\)\.addEventListener\('click', fermerFiche\)/);
  });

  it('elle se ferme quand un passage démarre, pour laisser voir le journal en direct', () => {
    assert.match(js, /function fermerSiUnPassageDemarre\(e\)/);
    assert.match(js, /function rendre\(e\) \{[\s\S]*?fermerSiUnPassageDemarre\(e\);[\s\S]*?\n\}/);
  });

  it('son bouton « Lancer » ferme la fiche d\'abord, puis lance avec le bouton de la ligne (budget compris)', () => {
    assert.match(js, /\$\('fiche-lancer'\)\.addEventListener\('click', \(\) => \{\n\s+if \(ficheId === null\) return;\n\s+const id = ficheId;\n\s+fermerFiche\(\);\n\s+lancer\(id, strips\.get\(id\)\.querySelector\('\.lancer'\)\);/);
  });

  it('un lancement refusé (budget) ferme la fiche : l\'alerte, la ligne du journal et le message restent visibles', () => {
    assert.match(js, /if \(!reponse\.ok\) \{\n\s+fermerFiche\(\);[^\n]*\n\s+toast\(/);
    const zIndex = (selecteur) => Number(new RegExp(`\\n${selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1]);
    assert.ok(zIndex('.toast') > zIndex('.fiche'), `le message (${zIndex('.toast')}) passe au-dessus de la fiche (${zIndex('.fiche')})`);
  });

  it('à 1500 px et plus, elle se pose par-dessus la colonne de droite ; cachée, elle ne prend aucune place', () => {
    assert.match(css, /\.fiche \{ grid-column: 2; grid-row: 1 \/ 4; \}/);
    assert.match(css, /\.fiche\[hidden\] \{ display: none; \}/);
  });
});

describe('fiche d\'un agent : l\'état donne son dernier passage', () => {
  it('début, coût et fichier produit du dernier passage, tels que le journal les a écrits', () => {
    const maintenant = new Date(2026, 9, 28, 14, 0, 0);
    const debut = isoLocal(new Date(2026, 9, 28, 9, 0, 0));
    const fin = isoLocal(new Date(2026, 9, 28, 9, 1, 0));
    const e = construireEtat({
      agents: [{ id: 'alpha', nom: 'Alpha', description: 'd', planning: null, budget_jour_eur: 1, outils: ['Read'], max_tours: 5 }],
      invalides: [],
      entrees: [{ agent: 'alpha', agent_nom: 'Alpha', debut, fin, statut: 'reussi', cout_eur: 0.042, duree_ms: 1000, resultat: 'out/alpha/r.md', bilan: 'ok' }],
      enCours: new Map(),
      maintenant,
      config: configTest(),
      claude: null,
    });
    const [carte] = e.agents;
    assert.equal(carte.dernier_debut, debut);
    assert.equal(carte.dernier_cout_eur, 0.042);
    assert.equal(carte.dernier_resultat, 'out/alpha/r.md');
  });
});

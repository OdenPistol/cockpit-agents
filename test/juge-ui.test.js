// L'écran du Juge : l'affichage du statut sous l'agent vérifié, le verdict, les boutons. app.js ne peut rien importer :
// on en extrait les fonctions et on les fait tourner sur un faux document minimal (aucun navigateur, aucune dépendance).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ETATS_VERIFICATION } from '../src/juge.js';
import { RACINE_REELLE } from './aide.js';

const lire = (nom) => fs.readFileSync(path.join(RACINE_REELLE, 'public', nom), 'utf8');
const js = lire('app.js');
const css = lire('style.css');
const html = lire('index.html');
const serveur = fs.readFileSync(path.join(RACINE_REELLE, 'src', 'serveur.js'), 'utf8');

/** Un faux élément du DOM : juste de quoi construire le verdict et lire ce qu'il montre. */
class Noeud {
  constructor(balise) {
    this.balise = balise;
    this.className = '';
    this.enfants = [];
    this.ecouteurs = {};
    this.attributs = {};
    this._texte = '';
  }

  set textContent(t) { this._texte = String(t); this.enfants = []; }

  get textContent() { return this._texte + this.enfants.map((e) => e.textContent).join(''); }

  append(...noeuds) { this.enfants.push(...noeuds); }

  replaceChildren(...noeuds) { this._texte = ''; this.enfants = noeuds; }

  setAttribute(nom, valeur) { this.attributs[nom] = valeur; }

  addEventListener(type, fn) { (this.ecouteurs[type] ??= []).push(fn); }

  clic() { for (const fn of this.ecouteurs.click ?? []) fn({ stopPropagation() {} }); }

  tous(predicat, acc = []) {
    if (predicat(this)) acc.push(this);
    for (const e of this.enfants) e.tous(predicat, acc);
    return acc;
  }

  avecClasse(classe) { return this.tous((n) => n.className.split(' ').includes(classe)); }
}

const extraire = (nom) => new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(js)?.[0];
const sources = ['el', 'plurielSi', 'compte', 'actionVerification', 'construireVerdict'].map(extraire);
const document = { createElement: (b) => new Noeud(b), createTextNode: (t) => { const n = new Noeud('#texte'); n.textContent = t; return n; } };

function monter(journalDesAppels = []) {
  assert.ok(sources.every(Boolean), 'el, plurielSi, compte, actionVerification et construireVerdict doivent être dans app.js');
  const fermetures = [];
  return {
    appels: journalDesAppels,
    fermetures,
    ecran: new Function(
      'document', 'fermerResultat', 'agir',
      `${sources.join('\n')}\nreturn { actionVerification, construireVerdict };`,
    )(document, () => fermetures.push('fermer'), (...a) => journalDesAppels.push(a)),
  };
}

const CRITERES = [
  { n: 1, ok: true, texte: 'Chaque facture du tableau est impayée.' },
  { n: 2, ok: true, texte: 'Aucune facture n\'est oubliée.' },
  { n: 3, ok: false, texte: 'Le montant TTC est égal au HT plus la TVA.' },
];
const agent = (verification = {}, verdict = {}) => ({
  id: 'factures',
  nom: 'Factures',
  verification: {
    etat: 'rejete',
    texte: 'Rejeté : 1 correction',
    detail: null,
    criteres: 3,
    corrections: 1,
    peut_verifier: false,
    peut_relancer: true,
    verdict: {
      chemin: 'out/juge/verdict-factures-2026-10-31-1.md',
      verdict: 'rejete',
      bilan: 'Factures rejeté, 1 correction.',
      criteres: CRITERES,
      corrections: [{ n: 1, texte: 'Écrire 1 560,00 € pour F-2026-0079.', preuve: '« 1 650,00 € », ligne 20 : 1300 + 260 = 1560.' }],
      debut: '2026-10-31T13:05:00+01:00',
      duree_ms: 41000,
      cout_eur: 0.05,
      ...verdict,
    },
    ...verification,
  },
});

describe('l\'écran : le verdict du Juge', () => {
  it('un rejet : « Rejeté », le score, chaque critère OK ou écart, les corrections avec leur preuve', () => {
    const { ecran } = monter();
    const page = ecran.construireVerdict(agent());
    const carte = page.avecClasse('verdict')[0];
    assert.ok(carte.className.split(' ').includes('refus'));
    assert.equal(page.avecClasse('verdict-score')[0].textContent, '2/3');
    assert.equal(page.avecClasse('verdict-titre')[0].avecClasse('verdict-suite')[0].textContent, '1 correction à faire');
    assert.equal(page.avecClasse('verdict-titre')[0].enfants[0].textContent, 'Rejeté');
    const criteres = page.avecClasse('critere');
    assert.deepEqual(criteres.map((c) => c.className), ['critere ok', 'critere ok', 'critere rate']);
    assert.deepEqual(criteres.map((c) => c.avecClasse('etat')[0].textContent), ['OK', 'OK', 'Écart']);
    assert.equal(criteres[2].avecClasse('critere-texte')[0].textContent, '3. Le montant TTC est égal au HT plus la TVA.');
    const corrections = page.avecClasse('correction');
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0].enfants[0].textContent, 'Écrire 1 560,00 € pour F-2026-0079.');
    assert.equal(corrections[0].enfants[1].textContent, 'Preuve : « 1 650,00 € », ligne 20 : 1300 + 260 = 1560.');
  });

  it('« 1 correction à faire », « 2 corrections à faire » : accordé', () => {
    const { ecran } = monter();
    const deux = [{ n: 1, texte: 'a', preuve: 'p' }, { n: 2, texte: 'b', preuve: 'q' }];
    assert.equal(ecran.construireVerdict(agent({}, { corrections: deux })).avecClasse('verdict-suite')[0].textContent, '2 corrections à faire');
  });

  it('un accord : « Accepté », tous les critères respectés, aucune correction, aucun bouton de relance', () => {
    const { ecran } = monter();
    const tous = CRITERES.map((c) => ({ ...c, ok: true }));
    const page = ecran.construireVerdict(agent({ etat: 'accepte', texte: 'Vérifié par le Juge : accepté', peut_relancer: false }, { verdict: 'accepte', criteres: tous, corrections: [] }));
    assert.ok(page.avecClasse('verdict')[0].className.split(' ').includes('ok'));
    assert.equal(page.avecClasse('verdict-score')[0].textContent, '3/3');
    assert.equal(page.avecClasse('verdict-titre')[0].enfants[0].textContent, 'Accepté');
    assert.equal(page.avecClasse('verdict-suite')[0].textContent, 'tous les critères sont respectés');
    assert.equal(page.avecClasse('correction').length, 0);
    assert.equal(page.avecClasse('verdict-relance').length, 0);
    assert.equal(page.avecClasse('verdict-rien').length, 0);
  });

  it('un rejet attend une décision : « Relancer avec les corrections » ou « Ne rien faire », rien ne part seul', () => {
    const { ecran, appels, fermetures } = monter();
    const page = ecran.construireVerdict(agent());
    assert.deepEqual(appels, [], 'rien n\'est lancé à l\'ouverture');
    const [relancer] = page.avecClasse('verdict-relance');
    const [rien] = page.avecClasse('verdict-rien');
    assert.equal(relancer.textContent, 'Relancer avec les corrections');
    assert.equal(rien.textContent, 'Ne rien faire');
    rien.clic();
    assert.deepEqual(appels, [], '« Ne rien faire » ne lance rien');
    assert.deepEqual(fermetures, ['fermer']);
    relancer.clic();
    assert.deepEqual(fermetures, ['fermer', 'fermer'], 'le tiroir se ferme d\'abord');
    assert.deepEqual(appels.map((a) => [a[0], a[1]]), [['factures', 'relancer-avec-corrections']]);
  });

  it('pendant que l\'agent tourne (peut_relancer faux), le bouton de relance disparaît ; le lien vers le fichier du verdict reste', () => {
    const { ecran } = monter();
    const page = ecran.construireVerdict(agent({ peut_relancer: false }));
    assert.equal(page.avecClasse('verdict-relance').length, 0);
    const [brut] = page.avecClasse('verdict-brut');
    assert.equal(brut.href, '/out/juge/verdict-factures-2026-10-31-1.md');
    assert.equal(brut.rel, 'noopener');
  });

  it('un texte venu du verdict n\'est jamais interprété : il n\'y a que des noeuds de texte', () => {
    const { ecran } = monter();
    const piege = '<img src=x onerror=alert(1)>';
    const page = ecran.construireVerdict(agent({}, { corrections: [{ n: 1, texte: piege, preuve: piege }] }));
    const [correction] = page.avecClasse('correction');
    assert.equal(correction.enfants[0].textContent, piege);
    assert.ok(correction.tous((n) => n.balise === 'img').length === 0);
  });
});

describe('l\'écran : le bouton à côté du statut', () => {
  const { ecran } = monter();
  const v = (surcharges) => ({ etat: 'a_verifier', peut_verifier: false, peut_relancer: false, ...surcharges });

  it('à vérifier : « Lancer le Juge » ; verdict illisible ou Juge en échec : « Relancer le Juge »', () => {
    assert.deepEqual(ecran.actionVerification(v({ peut_verifier: true })), { geste: 'verifier', texte: 'Lancer le Juge' });
    assert.deepEqual(ecran.actionVerification(v({ etat: 'illisible', peut_verifier: true })), { geste: 'verifier', texte: 'Relancer le Juge' });
    assert.deepEqual(ecran.actionVerification(v({ etat: 'juge_echec', peut_verifier: true })), { geste: 'verifier', texte: 'Relancer le Juge' });
  });

  it('rejeté : « Relancer avec les corrections »', () => {
    assert.deepEqual(ecran.actionVerification(v({ etat: 'rejete', peut_relancer: true })), { geste: 'relancer-avec-corrections', texte: 'Relancer avec les corrections' });
  });

  it('accepté, en cours, pas encore de sortie, ou un agent occupé : aucun bouton', () => {
    for (const surcharges of [{ etat: 'accepte' }, { etat: 'en_cours' }, { etat: 'sans_sortie' }, { etat: 'a_verifier' }, { etat: 'rejete' }, { etat: 'dod_illisible' }]) {
      assert.equal(ecran.actionVerification(v(surcharges)), null, JSON.stringify(surcharges));
    }
  });

  it('les gestes sont ceux que le serveur écoute', () => {
    for (const geste of ['verifier', 'relancer-avec-corrections']) {
      assert.ok(serveur.includes(geste), geste);
      assert.ok(js.includes(`'${geste}'`), geste);
    }
    assert.match(js, /fetch\(`\/api\/agents\/\$\{encodeURIComponent\(id\)\}\/\$\{geste\}`, \{ method: 'POST', headers: \{ 'X-Cockpit': '1' \} \}\)/);
  });
});

describe('l\'écran : la page, le style', () => {
  const classes = (source, motif) => new Set([...source.matchAll(motif)].map((m) => m[1]));

  it('chaque état de la vérification a sa couleur, et le bleu reste celui de « en cours » seulement', () => {
    for (const etat of ETATS_VERIFICATION) assert.ok(css.includes(`.verif[data-etat="${etat}"]`), `couleur de « ${etat} »`);
    assert.deepEqual([...ETATS_VERIFICATION].sort(), ['a_verifier', 'accepte', 'dod_illisible', 'en_cours', 'illisible', 'juge_echec', 'rejete', 'sans_sortie']);
    const bleues = css.split('\n').filter((l) => l.includes('.verif') && l.includes('var(--bleu)'));
    assert.ok(bleues.length >= 1 && bleues.every((l) => l.includes('en_cours')));
    assert.ok(!css.split('\n').some((l) => l.includes('.verif[data-etat="en_cours"]') && l.includes('var(--violet)')), 'pas de violet pour « en cours »');
  });

  it('chaque classe que le verdict utilise a une règle de style', () => {
    const corps = /function construireVerdict\([^)]*\) \{[\s\S]*?\n\}\n/.exec(js)[0];
    const utilisees = classes(corps, /el\('[a-z0-9]+', `?'?([a-z-]+)/g);
    for (const c of ['verdict-page', 'verdict', 'verdict-tete', 'verdict-score', 'verdict-titre', 'verdict-suite', 'verdict-criteres', 'critere', 'critere-texte', 'marque', 'etat', 'verdict-corrections', 'etiquette', 'corrections-liste', 'correction', 'preuve', 'verdict-actions', 'verdict-relance', 'verdict-rien', 'verdict-brut']) {
      assert.ok(utilisees.has(c) || corps.includes(c), `« ${c} » n'est pas utilisée par construireVerdict`);
      assert.ok(new RegExp(`\\.${c}[\\s{,:.]`).test(css), `« .${c} » n'a aucune règle dans style.css`);
    }
  });

  it('les boutons de la ligne du Juge n\'ont pas la classe « lancer » : le bouton « Lancer » de la fiche reste celui de la ligne', () => {
    const verif = /function majVerification\([^)]*\) \{[\s\S]*?\n\}\n/.exec(js)[0];
    assert.ok(!/'lancer'|"lancer"|\.lancer/.test(verif.replace(/'lancer-avec/g, '')), 'majVerification n\'utilise jamais la classe lancer');
    assert.match(js, /function lancer\(id, bouton\) \{\n  return agir\(id, 'lancer', bouton\);\n\}/);
  });

  it('un clic dans la zone du Juge n\'ouvre pas la fiche de l\'agent ; le statut ouvre le verdict quand il y en a un', () => {
    assert.match(js, /zone\.addEventListener\('click', \(evenement\) => evenement\.stopPropagation\(\)\);/);
    assert.match(js, /if \(courant\?\.verification\?\.verdict\) ouvrirVerdict\(courant, statut\);/);
  });

  it('la zone du Juge est à côté du nom, pas dedans (le nom est un bouton, et des boutons ne s\'emboîtent pas), juste après lui', () => {
    const verif = /function majVerification\([^)]*\) \{[\s\S]*?\n\}\n/.exec(js)[0];
    assert.match(verif, /li\.querySelector\('\.strip-nom'\)\.after\(zone\);/);
    assert.ok(!/\.strip-nom'\)\.append\(zone\)/.test(verif));
    assert.ok(!/el\('span'/.test(verif), 'aucun <span> : la règle « deux lignes au plus » ne les toucherait pas non plus');
    assert.match(verif, /li\.classList\.toggle\('avec-verif', Boolean\(v\)\);/);
  });

  it('à 1500 px et plus, la ligne du Juge se pose sous le nom, dans sa colonne, et les autres colonnes s\'étendent sur les deux lignes ; en une colonne, elle prend toute la largeur', () => {
    const large = css.slice(css.indexOf('@media (min-width: 1500px) {\n  .strip.avec-verif'), css.indexOf('/* le verdict, dans le tiroir du lecteur'));
    assert.match(large, /\.strip\.avec-verif > \.strip-nom \{ grid-row: 1; grid-column: 2; align-self: end; \}/);
    assert.match(large, /\.strip\.avec-verif > \.verif \{ grid-row: 2; grid-column: 2; align-self: start; \}/);
    for (const colonne of ['.rail', '.strip-statut', '.strip-dernier', '.strip-prochain', '.strip-cout', '.lancer']) {
      assert.ok(large.includes(`.strip.avec-verif > ${colonne}`), colonne);
    }
    assert.match(large, /grid-row: 1 \/ span 2;/);
    const etroit = css.slice(css.indexOf('@media (max-width: 1499px)'), css.indexOf('@media (max-width: 700px)'));
    assert.match(etroit, /\.strip \.verif \{ grid-column: 2 \/ 4; margin-top: 0; \}/);
    assert.match(etroit, /\.strip\.avec-verif \.rail \{ grid-row: 1 \/ span 5; \}/);
  });

  it('le verdict se remet à jour ou se ferme quand l\'état change, et se ferme avec Échap comme tout résultat', () => {
    assert.match(js, /function rafraichirVerdict\(e\)/);
    assert.match(js, /rendrePied\(e\);\n  rafraichirVerdict\(e\);/);
    assert.match(js, /if \(!\$\('lecteur'\)\.hidden\) fermerResultat\(\);/);
  });

  it('la fiche montre la vérification et ouvre le verdict', () => {
    assert.match(html, /id="fiche-verif-bloc" hidden/);
    assert.match(html, /id="fiche-verdict" hidden>Ouvrir le verdict</);
    assert.match(js, /verification: agent\.verification \? agent\.verification\.texte : null,/);
  });
});

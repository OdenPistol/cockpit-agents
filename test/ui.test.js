// Contrôles statiques de l'écran : lisibilité en capture 1080p, palette, contraste, sécurité de la page.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compte, plurielSi } from '../src/utilitaires.js';
import { RACINE_REELLE } from './aide.js';

const lire = (nom) => fs.readFileSync(path.join(RACINE_REELLE, 'public', nom), 'utf8');
const css = lire('style.css');
const html = lire('index.html');
const js = lire('app.js');

// Pour chaque variable : la valeur de :root (la première) et toutes les valeurs, y compris celles des paliers de largeur.
const toutes = {};
for (const [, nom, valeur] of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) (toutes[nom] ??= []).push(valeur.trim());
const variables = Object.fromEntries(Object.entries(toutes).map(([nom, valeurs]) => [nom, valeurs[0]]));
const cssSansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
const regles = [...cssSansCommentaires.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, selecteur, corps]) => ({ selecteur: selecteur.trim().replace(/\s+/g, ' '), corps }));

function hex(couleur) {
  const m = /^#([0-9a-f]{6})$/i.exec(couleur);
  assert.ok(m, `couleur hexadécimale attendue, reçu « ${couleur} »`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contraste(a, b) {
  const [la, lb] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}
function teinte([r, g, b]) {
  const [rn, gn, bn] = [r, g, b].map((v) => v / 255);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

// Seuils pour un écran filmé à 120 % (et non plus 125 %) : tout environ 15 % plus petit,
// compteur du coût du jour deux fois plus petit dans un bandeau mince.
describe('lisible dans un enregistrement 1080p filmé à 120 %', () => {
  it('aucun texte sous 14 px : toutes les tailles de police déclarées sont des pixels ≥ 14 ou des variables ≥ 14', () => {
    const tailles = [...css.matchAll(/font-size\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(tailles.length > 20);
    for (const t of tailles) {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(t);
      const v = /^var\(--(t-[a-z]+)\)$/.exec(t);
      assert.ok(px || v, `taille non vérifiable : ${t} (utiliser des px ou les variables --t-*)`);
      const valeur = px ? Number(px[1]) : Number(/^(\d+)px$/.exec(variables[v[1]])[1]);
      assert.ok(valeur >= 14, `taille trop petite : ${t}`);
    }
  });

  it('les chiffres clés font au moins 24 px, le compteur du coût du jour au moins 40 px', () => {
    const px = (valeur) => Number(/^(\d+)px$/.exec(valeur)[1]);
    for (const nom of ['t-chiffre', 't-gros', 't-hero']) {
      for (const valeur of toutes[nom]) assert.ok(px(valeur) >= 24, `${nom} = ${valeur} (tous les paliers de largeur comptent)`);
    }
    assert.ok(toutes['t-hero'].every((v) => px(v) >= 40), 'le coût du jour reste le plus gros chiffre à tous les paliers');
    assert.ok(toutes['t-hero'].every((v) => px(v) <= 48), 'mais deux fois plus petit qu\'avant (96 px) : un bandeau mince');
    assert.ok(px(variables['t-corps']) >= 14 && px(variables['t-min']) >= 14);
    // coût d'un agent, plafond, reste, compteurs d'alertes : tous passent par ces variables
    for (const [selecteur, variable] of [['.cout-valeur', 't-chiffre'], ['.gros-chiffre', 't-gros'], ['.voyant .compte', 't-gros'], ['.palettes', 't-hero']]) {
      const bloc = new RegExp(`${selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*font-size\\s*:\\s*var\\(--${variable}\\)`).test(css);
      assert.ok(bloc, `${selecteur} doit utiliser --${variable}`);
    }
  });

  it('thème sombre contrasté : fond très sombre, texte clair, contrastes AAA pour le texte courant', () => {
    assert.ok(luminance(hex(variables.nuit)) < 0.02);
    assert.ok(contraste(variables.papier, variables.nuit) >= 7);
    assert.ok(contraste(variables.papier, variables.rack) >= 7);
    assert.ok(contraste(variables.brume, variables.rack) >= 7, 'texte secondaire sur le rack');
    assert.ok(contraste(variables.brume, variables['rack-2']) >= 7, 'texte secondaire sur une carte');
    assert.ok(contraste(variables['brume-2'], variables['rack-2']) >= 4.5, 'texte discret sur une carte');
    for (const signal of ['violet', 'bleu', 'menthe', 'orange', 'rose', 'gris']) {
      assert.ok(contraste(variables[signal], variables['rack-2']) >= 4.5, `${signal} sur une carte`);
      assert.ok(contraste(variables[signal], variables.nuit) >= 4.5, `${signal} sur le fond`);
    }
    for (const fond of ['violet', 'bleu', 'menthe', 'orange', 'rose']) {
      assert.ok(contraste(variables.nuit, variables[fond]) >= 4.5, `texte sombre sur un aplat ${fond} (bouton, voyant)`);
    }
  });
});

describe('identité visuelle propre : ni cyan, ni or', () => {
  it('aucune couleur de la feuille de style n\'est cyan ou or (teinte et saturation mesurées)', () => {
    const couleurs = new Set(css.match(/#[0-9a-f]{6}\b/gi)?.map((c) => c.toLowerCase()));
    assert.ok(couleurs.size >= 10);
    for (const c of couleurs) {
      const { h, s, l } = teinte(hex(c));
      const colore = s > 0.25 && l > 0.18 && l < 0.92;
      assert.ok(!(colore && h >= 165 && h <= 205), `${c} est cyan (teinte ${Math.round(h)}°)`);
      assert.ok(!(colore && h >= 38 && h <= 62), `${c} est or ou jaune (teinte ${Math.round(h)}°)`);
    }
  });

  it('les couleurs de signal sont bien distinctes', () => {
    const teintes = ['violet', 'menthe', 'orange', 'rose', 'bleu'].map((n) => teinte(hex(variables[n])).h);
    assert.ok(Math.abs(teintes[0] - 255) < 15, 'violet');
    assert.ok(Math.abs(teintes[1] - 153) < 15, 'menthe');
    assert.ok(Math.abs(teintes[2] - 21) < 15, 'orange vif, pas ambre');
    assert.ok(Math.abs(teintes[3] - 347) < 15, 'rose-rouge');
    assert.ok(Math.abs(teintes[4] - 220) < 15, 'bleu');
    assert.ok(teintes[0] - teintes[4] >= 25, 'le bleu de « en cours » se distingue du violet des boutons');
  });

  it('l\'agent en cours a sa couleur à lui : le bleu ne sert à rien d\'autre, et les boutons « Lancer » restent violets', () => {
    const avecBleu = regles.filter((r) => r.corps.includes('var(--bleu)'));
    assert.ok(avecBleu.length >= 3, 'rail, voyant et texte du statut');
    for (const r of avecBleu) assert.ok(r.selecteur.includes('en_cours'), `« ${r.selecteur} » utilise le bleu sans être le statut « en cours »`);
    const lancer = regles.find((r) => r.selecteur === '.lancer');
    assert.match(lancer.corps, /color:\s*var\(--violet\)/, 'le bouton « Lancer » est violet (texte et liseré)');
    const survol = regles.find((r) => r.selecteur.startsWith('.lancer:hover'));
    assert.match(survol.corps, /background:\s*var\(--violet\)/, 'au survol, il se remplit de violet');
    assert.ok(!/en_cours[^{]*\{[^}]*var\(--violet\)/.test(css), 'plus de violet pour l\'agent en cours');
  });

  it('le nom affiché n\'est pas une marque', () => {
    assert.match(html, /<h1>Cockpit d'agents<\/h1>/);
    assert.match(html, /id="horloge"/, 'l\'en-tête montre l\'heure et la date, comme un outil en service');
    assert.ok(!/démo libre/i.test(html), 'plus de mention « démo » dans l\'en-tête');
  });
});

describe('disposition : rien de coupé, ni caché', () => {
  it('trois paliers de largeur : large (1810 px), compact pour un zoom 125 % (1500 à 1809 px), une colonne en dessous', () => {
    assert.match(css, /@media \(min-width: 1810px\)/);
    assert.match(css, /@media \(min-width: 1500px\) and \(max-width: 1809px\)/);
    assert.match(css, /@media \(max-width: 1499px\)/);
  });

  it('la liste des agents passe avant les alertes : elle prend la place de son contenu, les alertes se partagent le reste', () => {
    const gauche = regles.find((r) => r.selecteur === '.colonne.gauche');
    assert.match(gauche.corps, /grid-template-rows:\s*minmax\(0, auto\) minmax\(96px, 1fr\)/);
  });

  it('la description d\'un agent passe à la ligne (deux lignes au plus) au lieu d\'être coupée par des points de suspension', () => {
    const regle = regles.find((r) => r.selecteur === '.strip-nom span');
    assert.match(regle.corps, /-webkit-line-clamp:\s*2/);
    assert.ok(!/text-overflow\s*:\s*ellipsis/.test(regle.corps), 'plus de points de suspension');
    assert.ok(!/white-space\s*:\s*nowrap/.test(regle.corps), 'plus de ligne unique forcée');
    assert.ok(/\.title\s*=\s*agent\.description|title = agent\.description/.test(js), 'le texte complet reste dans l\'infobulle');
  });

  it('à 125 % de zoom (1500 à 1809 px) : la colonne du nom prend le reste, l\'historique perd sa durée et tient sans défiler à droite, neuf agents tiennent', () => {
    const palier = css.slice(css.indexOf('@media (min-width: 1500px) and (max-width: 1809px) {'), css.indexOf('@media (min-width: 1500px) and (max-width: 1809px) and (min-height: 700px)'));
    assert.ok(palier.length > 500);
    assert.match(palier, /--colonnes-strip:\s*12px minmax\(200px, 1fr\)/);
    assert.match(palier, /\.historique th:nth-child\(3\), \.historique td:nth-child\(3\) \{ display: none; \}/);
    assert.match(palier, /\.historique td:nth-child\(5\) \{ white-space: normal; \}/);
    assert.match(palier, /grid-auto-rows:\s*minmax\(min-content, 56px\)/);
    assert.match(palier, /\.toast \{ max-width: 460px; \}/);
    // les colonnes fixes d'une ligne d'agent + celle du nom + les écarts doivent tenir dans la colonne de gauche à 1536 px
    const colonnes = /--colonnes-strip:\s*([^;]+);/.exec(palier)[1].trim().split(/\s+/).join(' ');
    const fixes = [...colonnes.matchAll(/(?<!\()\b(\d+)px\b(?![^()]*\))/g)].map((m) => Number(m[1]));
    const droite = Number(/--col-droite:\s*(\d+)px/.exec(palier)[1]);
    const gauche = 1536 - 2 * 24 - droite - 14; // largeur de la fenêtre à 125 %, marges, colonne de droite, écart
    assert.equal(fixes.length, 6, `colonnes de largeur fixe : ${fixes}`);
    const occupe = fixes.reduce((t, x) => t + x, 0) + 6 * 12 + 16; // 6 écarts de 12 px entre les 7 colonnes, marge de droite de la liste
    const colonneNom = gauche - occupe;
    assert.ok(colonneNom >= 254, `la colonne du nom aurait ${colonneNom} px : la plus longue description du dépôt en demande 254`);
  });

  it('en une seule colonne, rien ne dépasse à droite (la colonne ne s\'élargit pas avec le tableau de l\'historique)', () => {
    assert.match(css, /\.colonne\.gauche, \.colonne\.droite \{ grid-template-rows: none; grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('le pied d\'écran dit « configuration isolée » ou « configuration complète », jamais « propre »', () => {
    assert.match(js, /configuration \$\{e\.reglages\.configuration_isolee \? 'isolée' : 'complète'\}/);
    assert.ok(!/configuration propre|configuration_propre|'propre'/.test(js + html), 'plus de « propre » à l\'écran');
  });

  it('le statut « bloqué » tient dans sa colonne, les montants ne se coupent pas avant « € »', () => {
    assert.match(js, /bloque_budget: 'Bloqué',/);
    assert.match(js, /detail\.textContent = 'budget du jour'/);
    assert.match(js, /const typo = \(texte\) => texte\.replace\(\/\(\\d\) €\/g, '\$1\\u00a0€'\);/);
    assert.match(js, /toFixed\(decimales\)\.replace\('\.', ','\)\}\\u00a0€/);
  });

  it('le message flottant se pose au-dessus du pied de page : il ne masque jamais « en direct »', () => {
    const toast = regles.find((r) => r.selecteur === '.toast');
    const bas = Number(/bottom:\s*(\d+)px/.exec(toast.corps)[1]);
    assert.ok(bas >= 64, `bas du message : ${bas} px`);
  });

  it('le pied de page ne montre pas de nom de champ technique', () => {
    assert.ok(!html.includes('total_cost_usd'));
    assert.match(html, /Les coûts sont l'estimation de Claude Code, pas une facture\./);
  });

  it('aucun tiret cadratin, demi-cadratin ni signe moins typographique dans l\'écran', () => {
    for (const [nom, texte] of [['index.html', html], ['style.css', css], ['app.js', js]]) assert.ok(!/[\u2013\u2014\u2212]/.test(texte), nom);
  });

  it('l\'écran tutoie', () => {
    for (const interdit of [/\bvous\b/i, /\bvotre\b/i, /\bvos\b/i, /cliquez|lancez|vérifiez|ouvrez|tapez|relancez|installez/i]) {
      assert.ok(!interdit.test(html + js), String(interdit));
    }
  });
});

describe('accord en nombre à l\'écran : « 1 agent », « 5 agents »', () => {
  // app.js ne peut rien importer : on en extrait les trois petites fonctions et on les fait tourner.
  const extraire = (nom) => new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(js)?.[0];
  const sources = ['plurielSi', 'compte', 'resumeAgents'].map(extraire);
  const ecran = sources.every(Boolean) ? new Function(`${sources.join('\n')}\nreturn { plurielSi, compte, resumeAgents };`)() : null;

  it('les fonctions sont bien dans app.js', () => {
    assert.ok(ecran, 'plurielSi, compte et resumeAgents introuvables dans app.js');
  });

  it('le titre de la liste : « 1 agent », « 5 agents », « 5 agents · 1 en cours »', () => {
    assert.equal(ecran.resumeAgents(0, 0), '0 agent');
    assert.equal(ecran.resumeAgents(1, 0), '1 agent');
    assert.equal(ecran.resumeAgents(1, 1), '1 agent · 1 en cours');
    assert.equal(ecran.resumeAgents(5, 0), '5 agents');
    assert.equal(ecran.resumeAgents(6, 2), '6 agents · 2 en cours');
  });

  it('les passages au coût inconnu : « 1 passage », « 2 passages »', () => {
    assert.equal(ecran.compte(1, 'passage'), '1 passage');
    assert.equal(ecran.compte(2, 'passage'), '2 passages');
  });

  it('l\'écran et le serveur s\'accordent de la même façon, sur tous les cas', () => {
    for (const n of [0, 1, 1.5, 2, 3, 10, 1000, '0', '1', '2', '?', '', null, undefined, Number.NaN]) {
      assert.equal(ecran.plurielSi(n, 'agent'), plurielSi(n, 'agent'), String(n));
      assert.equal(ecran.compte(n, 'agent'), compte(n, 'agent'), String(n));
      assert.equal(ecran.plurielSi(n, 'cheval', 'chevaux'), plurielSi(n, 'cheval', 'chevaux'), String(n));
    }
  });

  it('aucun pluriel en dur derrière un nombre calculé dans app.js', () => {
    const m = js.match(/\$\{[^}]*\}\s+(outils|tours|agents|passages|caractères|fichiers|lignes|jours|messages|alertes|erreurs|essais|étapes|jetons|tentatives)\b/g);
    assert.equal(m, null, `compteur sans accord : ${m}`);
    assert.ok(!/[a-zéèêàâîôû]{4,}\((s|es)\)/.test(js), 'plus de « (s) »');
  });
});

describe('page sûre et sans dépendance', () => {
  it('aucun style ni script en ligne (compatible avec la politique de sécurité de la page)', () => {
    assert.ok(!/\sstyle\s*=/.test(html), 'attribut style en ligne');
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'script en ligne');
    assert.ok(!/<style[\s>]/.test(html), 'balise style en ligne');
    assert.ok(!/\bon[a-z]+\s*=/.test(html), 'gestionnaire d\'événement en ligne');
  });

  it('rien n\'est chargé depuis l\'extérieur', () => {
    for (const [nom, texte] of [['index.html', html], ['style.css', css], ['app.js', js]]) {
      assert.ok(!/https?:\/\//.test(texte.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${nom} contient une adresse externe`);
      assert.ok(!/@import|<link[^>]+href="https?:/.test(texte), nom);
    }
  });

  it('app.js n\'interprète jamais du texte comme du HTML', () => {
    for (const interdit of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      assert.ok(!js.includes(interdit), `app.js utilise ${interdit}`);
    }
  });

  it('accessibilité de base : langue, titre, boutons nommés, mouvement réduit respecté', () => {
    assert.match(html, /<html lang="fr">/);
    assert.match(js, /setAttribute\('aria-label', `Lancer l'agent/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /:focus-visible/);
  });
});

describe('lecteur de résultat : le Markdown mis en forme, sans jamais exécuter ce qu\'écrit un agent', () => {
  const extraire = (nom) => new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(js)?.[0];
  const sources = ['morceauxEnLigne', 'markdownVersBlocs'].map(extraire);
  const md = sources.every(Boolean) ? new Function(`${sources.join('\n')}\nreturn { morceauxEnLigne, markdownVersBlocs };`)() : null;

  it('les fonctions sont dans app.js', () => {
    assert.ok(md, 'morceauxEnLigne et markdownVersBlocs introuvables dans app.js');
  });

  it('le HTML écrit par un agent reste du texte : il n\'y a que des morceaux de texte, jamais de balise', () => {
    const blocs = md.markdownVersBlocs('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    assert.equal(blocs.length, 2);
    for (const b of blocs) for (const ligne of b.lignes) for (const m of ligne) assert.equal(m.type, 'texte');
    assert.equal(blocs[0].lignes[0][0].texte, '<script>alert(1)</script>');
  });

  it('un lien javascript: ne devient jamais un lien', () => {
    const morceaux = md.morceauxEnLigne('[clique](javascript:alert) et [ok](https://example.org/page)');
    assert.deepEqual(morceaux.filter((m) => m.type === 'lien').map((m) => m.url), ['https://example.org/page']);
    assert.ok(morceaux.some((m) => m.type === 'texte' && m.texte === 'clique'));
  });

  it('titres, listes, tableaux et gras sont reconnus', () => {
    const blocs = md.markdownVersBlocs('# Relances\n\n**Bilan** : 2 impayés\n\n- un\n- deux\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    assert.deepEqual(blocs.map((b) => b.type), ['titre', 'paragraphe', 'liste', 'tableau']);
    assert.equal(blocs[0].niveau, 2);
    assert.equal(blocs[1].lignes[0][0].type, 'gras');
    assert.equal(blocs[2].elements.length, 2);
    assert.equal(blocs[3].corps[0][1][0].texte, '2');
  });

  it('le lecteur construit la page élément par élément', () => {
    assert.match(js, /corps\.replaceChildren\(construireMarkdown\(markdownVersBlocs\(/);
  });

  it('le prochain passage dit « manuel » ou « auto », jamais « à la demande »', () => {
    assert.match(js, /fixer\(jourProchain, 'manuel'\)/);
    assert.match(js, /`auto · \$\{libelleJour\(agent\.prochain_passage\)\}`/);
    assert.ok(!/à la demande/.test(js + html));
  });
});

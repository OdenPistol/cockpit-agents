// « Ce qu'il a fait » : la ligne affichée sous le nom d'un agent qui a réussi aujourd'hui.
// Elle vient toujours de ce que l'agent a écrit : sa ligne de bilan, sinon son message final, sinon le début de son fichier.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { lireAgentMd } from '../src/agent-md.js';
import { bilanDuFichier, ceQuIlAFait, extraitDuFichier, ligneDuMessage } from '../src/bilan.js';
import { construireEtat } from '../src/etat.js';
import { lireJour } from '../src/journal.js';
import { executer } from '../src/lanceur.js';
import { isoLocal, jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, nettoyer, RACINE_REELLE } from './aide.js';

const exemple = (nom) => fs.readFileSync(path.join(RACINE_REELLE, 'docs', 'exemples-de-sorties', nom), 'utf8');

describe('ceQuIlAFait : la ligne de bilan présente dans le fichier de sortie', () => {
  it('une ligne « Bilan : … » donne son contenu, sans l\'étiquette', () => {
    const fichier = '# Relances du 2026-10-21\n\nBilan : 5 impayés de plus de 30 jours, total TTC 12 660,00 €.\n\n## Impayés\n';
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: fichier, messageFinal: 'Autre chose.' }), '5 impayés de plus de 30 jours, total TTC 12 660,00 €.');
  });

  it('« **Bilan :** » en gras se lit pareil', () => {
    assert.equal(bilanDuFichier('# Titre\n\n**Bilan :** 3 devis prêts.\n'), '3 devis prêts.');
    assert.equal(bilanDuFichier('# Titre\n\n**Bilan** : 3 devis prêts.\n'), '3 devis prêts.');
  });

  it('la ligne de chiffres juste sous le titre (« 17 à traiter · 10 factures · … »)', () => {
    assert.equal(
      ceQuIlAFait({ statut: 'reussi', texteFichier: exemple('tri-2026-10-21.md') }),
      '17 à traiter · 10 factures · 14 infos · 9 spams · 6 messages piégés',
    );
  });

  it('les sorties d\'exemple du dépôt donnent chacune une ligne écrite par l\'agent', () => {
    const attendus = {
      'tri-2026-10-21.md': '17 à traiter · 10 factures · 14 infos · 9 spams · 6 messages piégés',
      'relances-2026-10-21.md': '5 impayés de plus de 30 jours, total TTC 12 660,00 €.',
      'relances-prospects-2026-10-21.md': '7 prospects à relancer, 8 laissés tranquilles.',
      'devis-2026-10-21.md': '3 demandes · 3 devis · 2 points hors grille',
      'reponses-2026-10-21.md': '12 avis · 9 réponses · 3 avis suspects',
      'securite-2026-10-21.md': '9 agents · 0 alerte · 4 secrets',
    };
    for (const [nom, attendu] of Object.entries(attendus)) {
      assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: exemple(nom), messageFinal: 'out/x/y.md' }), attendu, nom);
    }
  });
});

describe('ceQuIlAFait : sans ligne de bilan, sans fichier, ou passage échoué', () => {
  it('ligne de bilan absente : la première ligne utile du message final', () => {
    const fichier = '# Résultat\n\nDu texte sans chiffres.\n';
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: fichier, messageFinal: 'J\'ai trié 12 emails.\nout/boite-mail/tri.md' }), 'J\'ai trié 12 emails.');
  });

  it('fichier manquant : le message final, sans son étiquette « Bilan : »', () => {
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: null, messageFinal: '\nBilan : 4 relances prêtes.\n../../out/factures/relances.md' }), '4 relances prêtes.');
  });

  it('message final réduit à un chemin : le début du fichier, entre « » (un extrait)', () => {
    assert.equal(
      ceQuIlAFait({ statut: 'reussi', texteFichier: exemple('veille-2026-10-21.md'), messageFinal: 'out/veille/veille-2026-10-21.md' }),
      '« Trois sujets à retenir aujourd\'hui : l\'assistant de relances de factures Tarvio, le guide de bonnes pratiques pour les très petites entreprises, et l\'étude sur les consignes cachées dans les courriels. »',
    );
    assert.equal(
      ceQuIlAFait({ statut: 'reussi', texteFichier: exemple('post-2026-10-21.md'), messageFinal: 'Fichier écrit : `out/contenu/post-2026-10-21.md`' }),
      '« Changer d\'outil ne règle presque jamais le problème. »',
    );
  });

  it('un fichier qui commence par une liste : son titre seul, tel que l\'agent l\'a écrit, sans aucun compte', () => {
    assert.equal(
      ceQuIlAFait({ statut: 'reussi', texteFichier: exemple('rapport-du-matin.md'), messageFinal: 'out/rapport-du-matin/point-2026-10-21.md' }),
      'Point du matin : mercredi',
    );
    assert.equal(extraitDuFichier('# Seul\n\n- un\n'), 'Seul');
    assert.equal(extraitDuFichier('- un\n- deux\n'), '« un »', 'sans titre : la première ligne, en extrait');
  });

  it('un point de plusieurs lignes qui se suivent, sans puces : son titre seul ; deux lignes : un extrait', () => {
    const point = '# Point du matin : mercredi\nVeille : deux sujets. [veille]\nSécurité : 0 alerte. [securite]\nFactures : 6 impayés. [factures]\n';
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: point, messageFinal: 'out/rapport-du-matin/rapport-du-matin.md' }), 'Point du matin : mercredi');
    assert.equal(extraitDuFichier('# Post\n\nUne phrase.\nUne autre.\n\nSuite.'), '« Une phrase. »');
  });

  it('jamais un nombre que l\'agent n\'a pas écrit', () => {
    for (const nom of ['veille-2026-10-21.md', 'post-2026-10-21.md', 'rapport-du-matin.md']) {
      const texte = exemple(nom);
      const ligne = extraitDuFichier(texte);
      for (const n of ligne.match(/\d+/g) ?? []) assert.ok(texte.includes(n), `${nom} : « ${n} » n'est pas dans le fichier`);
    }
    const point = '# Point du matin : mercredi\nA : x.\nB : y.\nC : z.\n';
    assert.equal(extraitDuFichier(point).match(/\d/), null, 'aucun chiffre inventé pour un fichier qui n\'en contient pas');
  });

  it('ni fichier ni message utilisable : null (l\'écran garde la description)', () => {
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: null, messageFinal: null }), null);
    assert.equal(ceQuIlAFait({ statut: 'reussi', texteFichier: '', messageFinal: 'out/a/b.md' }), null);
    assert.equal(ligneDuMessage('# Titre seul\n\n| a | b |'), null);
  });

  it('passage échoué : null, même avec un fichier et un message', () => {
    assert.equal(ceQuIlAFait({ statut: 'echec', texteFichier: exemple('tri-2026-10-21.md'), messageFinal: 'Bilan : 3.' }), null);
    assert.equal(ceQuIlAFait({ statut: 'bloque_budget', texteFichier: null, messageFinal: null }), null);
  });

  it('une ligne trop longue est coupée proprement, avec des points de suspension', () => {
    const ligne = ceQuIlAFait({ statut: 'reussi', texteFichier: `# T\n\nBilan : ${'mot '.repeat(120)}\n` });
    assert.ok(ligne.length <= 240, String(ligne.length));
    assert.ok(ligne.endsWith('…'));
  });
});

describe('le passage garde son bilan et ses étapes dans le journal', () => {
  async function passage(scenario) {
    const racine = creerProjet({ alpha: agentMd() });
    const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
    const avant = process.env.FAKE_CLAUDE;
    process.env.FAKE_CLAUDE = scenario;
    try {
      const entree = await executer({ agent, config: configTest(), racine, declencheur: 'manuel' }).promesse;
      return { racine, entree };
    } finally {
      if (avant === undefined) delete process.env.FAKE_CLAUDE; else process.env.FAKE_CLAUDE = avant;
    }
  }

  it('réussi : la ligne vient du message final (le faux fichier n\'a pas de bilan), les étapes finissent par « Terminé »', async () => {
    const { racine, entree } = await passage('reussi');
    try {
      assert.equal(entree.statut, 'reussi');
      assert.equal(entree.bilan, 'Terminé.');
      assert.ok(entree.etapes.length >= 3, JSON.stringify(entree.etapes));
      assert.ok(entree.etapes.some((l) => l.texte === 'Lit data/lisez-moi.txt'));
      assert.equal(entree.etapes.at(-1).niveau, 'fin');
      assert.match(entree.etapes.at(-1).texte, /^Terminé en 1 s · 3 tours · /);
      const [ligne] = lireJour(path.join(racine, 'journal'), jourLocal(new Date(entree.debut)));
      assert.equal(ligne.bilan, 'Terminé.');
      assert.equal(ligne.etapes.length, entree.etapes.length);
    } finally {
      nettoyer(racine);
    }
  });

  it('échoué : aucun bilan, les étapes finissent par l\'erreur', async () => {
    const { racine, entree } = await passage('echec');
    try {
      assert.equal(entree.statut, 'echec');
      assert.equal(entree.bilan, null);
      assert.equal(entree.etapes.at(-1).niveau, 'erreur');
      assert.match(entree.etapes.at(-1).texte, /^Échec : /);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('l\'état de l\'écran : « ce qu\'il a fait », le nombre de tâches, le dernier passage', () => {
  const maintenant = new Date(2026, 9, 28, 14, 0, 0);
  const a = (h, m) => isoLocal(new Date(2026, 9, 28, h, m, 0));
  const agents = [
    { id: 'alpha', nom: 'Alpha', description: 'Desc alpha', planning: null, budget_jour_eur: 1, outils: ['Read'], max_tours: 5 },
    { id: 'beta', nom: 'Beta', description: 'Desc beta', planning: null, budget_jour_eur: 1, outils: ['Read'], max_tours: 5 },
    { id: 'gamma', nom: 'Gamma', description: 'Desc gamma', planning: null, budget_jour_eur: 1, outils: ['Read'], max_tours: 5 },
  ];
  const ligne = (agent, debut, fin, statut, bilan, etapes = [{ ts: fin, niveau: 'fin', texte: 'Terminé' }]) => ({
    agent, agent_nom: agent[0].toUpperCase() + agent.slice(1), debut, fin, statut, cout_eur: 0.05, duree_ms: 1000, tours: 2, bilan, etapes,
  });
  const etat = (entrees) => construireEtat({ agents, invalides: [], entrees, enCours: new Map(), maintenant, config: configTest(), claude: null });

  it('réussi aujourd\'hui : sa ligne ; échoué en dernier : rien ; jamais lancé : rien', () => {
    const e = etat([
      ligne('alpha', a(9, 0), a(9, 1), 'reussi', '3 devis prêts'),
      ligne('beta', a(9, 2), a(9, 3), 'reussi', 'ancien bilan'),
      ligne('beta', a(10, 0), a(10, 1), 'echec', null),
    ]);
    const parId = Object.fromEntries(e.agents.map((c) => [c.id, c]));
    assert.equal(parId.alpha.fait, '3 devis prêts');
    assert.equal(parId.beta.fait, null, 'le dernier passage a échoué : la description reste');
    assert.equal(parId.gamma.fait, null);
    assert.equal(e.cout.taches_jour, 2, 'deux passages réussis aujourd\'hui');
  });

  it('un refus pour budget après un succès ne cache pas ce qu\'il a fait', () => {
    const e = etat([
      ligne('alpha', a(9, 0), a(9, 1), 'reussi', '3 devis prêts'),
      { agent: 'alpha', agent_nom: 'Alpha', debut: a(11, 0), fin: a(11, 0), statut: 'bloque_budget', cout_eur: 0 },
    ]);
    assert.equal(e.agents.find((c) => c.id === 'alpha').fait, '3 devis prêts');
    assert.equal(e.cout.taches_jour, 1);
  });

  it('le dernier passage terminé, avec ses étapes ; aucun passage : null', () => {
    assert.equal(etat([]).dernier_passage, null);
    const e = etat([
      ligne('alpha', a(9, 0), a(9, 5), 'reussi', 'x', [{ ts: a(9, 5), niveau: 'fin', texte: 'Terminé alpha' }]),
      ligne('beta', a(9, 1), a(9, 2), 'reussi', 'y', [{ ts: a(9, 2), niveau: 'fin', texte: 'Terminé beta' }]),
      { agent: 'gamma', agent_nom: 'Gamma', debut: a(12, 0), fin: a(12, 0), statut: 'bloque_budget', cout_eur: 0 },
    ]);
    assert.equal(e.dernier_passage.agent, 'alpha', 'le plus récent à finir, pas le plus récent à commencer ; un refus ne compte pas');
    assert.deepEqual(e.dernier_passage.etapes.map((l) => l.texte), ['Terminé alpha']);
  });
});

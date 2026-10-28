import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { essai } from '../src/essai.js';
import { lireJour } from '../src/journal.js';
import { jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, nettoyer } from './aide.js';

async function avecEnv(variables, fn) {
  const avant = {};
  for (const [cle, valeur] of Object.entries(variables)) {
    avant[cle] = process.env[cle];
    process.env[cle] = valeur;
  }
  try {
    return await fn();
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle]; else process.env[cle] = valeur;
    }
  }
}

describe('npm run essai', () => {
  const trois = () => creerProjet({
    a: agentMd({ nom: 'Un', budget: 5 }),
    b: agentMd({ nom: 'Deux', budget: 5 }),
    c: agentMd({ nom: 'Trois', budget: 5 }),
  });

  it('lance chaque agent une fois, à la suite, et affiche le coût total réel', async () => {
    const racine = trois();
    try {
      const sortie = [];
      const config = configTest({ ordre: ['c', 'a', 'b'] });
      const r = await avecEnv({ FAKE_COUT: '0.1' }, () => essai({ racine, config, afficher: (t) => sortie.push(t) }));
      assert.equal(r.code, 0);
      assert.deepEqual(r.resultats.map((x) => x.agent_nom), ['Trois', 'Un', 'Deux'], 'dans l\'ordre de config.json');
      assert.equal(r.total_eur, 0.258);
      const texte = sortie.join('\n');
      assert.match(texte, /Coût total réel de l'essai : 0,258 € \(0,3000 \$ au taux de 0,86 € pour 1 \$\)/);
      assert.match(texte, /équivalent API/);
      assert.match(texte, /Lit data\/lisez-moi\.txt/, 'les lignes du journal en direct sont affichées');

      const journal = lireJour(path.join(racine, 'journal'), jourLocal(new Date()));
      assert.equal(journal.length, 3);
      assert.ok(journal.every((e) => e.declencheur === 'essai'));
      // à la suite : chaque passage commence après la fin du précédent
      for (let i = 1; i < journal.length; i += 1) assert.ok(new Date(journal[i].debut) >= new Date(journal[i - 1].fin));
    } finally {
      nettoyer(racine);
    }
  });

  it('un échec est compté, signalé, et le code de sortie est non nul', async () => {
    const racine = trois();
    try {
      const sortie = [];
      const r = await avecEnv({ FAKE_CLAUDE: 'echec', FAKE_COUT: '0.05' }, () => essai({ racine, config: configTest(), afficher: (t) => sortie.push(t) }));
      assert.equal(r.code, 1);
      assert.match(sortie.join('\n'), /Échec : panne simulée/);
      assert.match(sortie.join('\n'), /Coût total réel de l'essai : 0,129 €/);
    } finally {
      nettoyer(racine);
    }
  });

  it('un agent dont le budget est dépassé est signalé et sauté, sans ligne de journal ; les autres tournent', async () => {
    const racine = creerProjet({ a: agentMd({ nom: 'Un', budget: 0.01 }), b: agentMd({ nom: 'Deux', budget: 5 }) });
    try {
      const sortie = [];
      const r = await essai({ racine, config: configTest({ estimation_defaut_eur: 0.15 }), afficher: (t) => sortie.push(t) });
      assert.equal(r.code, 1);
      assert.match(sortie.join('\n'), /✖ Un non lancé : il dépasserait son budget du jour \(0,01 €\)/);
      assert.deepEqual(r.resultats.map((x) => x.statut), ['refuse', 'reussi']);
      // aucune ligne pour l'agent sauté : pas d'alerte « budget » allumée pour la journée
      const journal = lireJour(path.join(racine, 'journal'), jourLocal(new Date()));
      assert.deepEqual(journal.map((l) => [l.agent, l.statut]), [['b', 'reussi']]);
    } finally {
      nettoyer(racine);
    }
  });

  it('accorde « 1 agent » et « 3 agents » dans l\'annonce', async () => {
    const un = creerProjet({ a: agentMd({ nom: 'Un', budget: 5 }) });
    const quatre = creerProjet({ a: agentMd({ nom: 'A', budget: 5 }), b: agentMd({ nom: 'B', budget: 5 }), c: agentMd({ nom: 'C', budget: 5 }), d: agentMd({ nom: 'D', budget: 5 }) });
    try {
      const sortieUn = [];
      await essai({ racine: un, config: configTest(), afficher: (t) => sortieUn.push(t) });
      assert.match(sortieUn.join('\n'), /Essai : 1 agent, un passage chacun/);
      assert.ok(!/1 agents/.test(sortieUn.join('\n')));
      const sortieQuatre = [];
      await essai({ racine: quatre, config: configTest(), afficher: (t) => sortieQuatre.push(t) });
      assert.match(sortieQuatre.join('\n'), /Essai : 4 agents, un passage chacun/);
    } finally {
      nettoyer(un);
      nettoyer(quatre);
    }
  });

  it('coût inconnu : « 1 passage ... n\'est pas dans ce total » au singulier, « 2 passages ... ne sont pas » au pluriel', async () => {
    const un = creerProjet({ a: agentMd({ nom: 'Un', budget: 5 }) });
    const deux = creerProjet({ a: agentMd({ nom: 'Un', budget: 5 }), b: agentMd({ nom: 'Deux', budget: 5 }) });
    try {
      const sortieUn = [];
      await avecEnv({ FAKE_CLAUDE: 'sans_result' }, () => essai({ racine: un, config: configTest(), afficher: (t) => sortieUn.push(t) }));
      assert.match(sortieUn.join('\n'), /1 passage au coût inconnu n'est pas dans ce total/);
      const sortieDeux = [];
      await avecEnv({ FAKE_CLAUDE: 'sans_result' }, () => essai({ racine: deux, config: configTest(), afficher: (t) => sortieDeux.push(t) }));
      assert.match(sortieDeux.join('\n'), /2 passages au coût inconnu ne sont pas dans ce total/);
      for (const sortie of [sortieUn, sortieDeux]) assert.ok(!/passage\(s\)/.test(sortie.join('\n')), 'plus de « (s) »');
    } finally {
      nettoyer(un);
      nettoyer(deux);
    }
  });

  it('Claude Code absent : message clair, rien ne tourne', async () => {
    const racine = trois();
    try {
      const sortie = [];
      const r = await essai({ racine, config: configTest({ commande_claude: '/non/existant/claude' }), afficher: (t) => sortie.push(t) });
      assert.equal(r.code, 1);
      assert.match(sortie.join('\n'), /introuvable/);
    } finally {
      nettoyer(racine);
    }
  });
});

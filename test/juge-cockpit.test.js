// Le Juge dans le cockpit, de bout en bout avec le faux « claude » : produire, juger, rejeter, relancer avec les corrections,
// accepter ; le budget du Juge ; rien d'automatique ; la sécurité de sa commande ; les routes du serveur.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { lireAgentMd } from '../src/agent-md.js';
import { Cockpit } from '../src/cockpit.js';
import { essai } from '../src/essai.js';
import { lireJour } from '../src/journal.js';
import { construireCommande } from '../src/lanceur.js';
import { demarrerServeur } from '../src/serveur.js';
import { jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, nettoyer, RACINE_REELLE } from './aide.js';

const DOD = '# Definition of done : Factures\n\n1. Premier critère vérifiable.\n2. Deuxième critère vérifiable.\n3. Troisième critère vérifiable.\n';
const JOUR = () => jourLocal(new Date());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Un projet avec un agent vérifié (Factures, qui a un dod.md) et le Juge ; un cockpit dessus. */
function monter({ config = {}, budgetJuge = 5, agents = {} } = {}) {
  const racine = creerProjet({
    factures: agentMd({ nom: 'Factures', budget: 5 }),
    juge: agentMd({ nom: 'Juge', budget: budgetJuge, outils: 'Read, Write', prompt: 'Tu es le Juge de test.' }),
    ...agents,
  });
  fs.writeFileSync(path.join(racine, 'agents', 'factures', 'dod.md'), DOD);
  const cockpit = new Cockpit({ racine, config: configTest(config) });
  return { racine, cockpit };
}
const verif = (cockpit, id = 'factures') => cockpit.etat().agents.find((a) => a.id === id).verification;
const journal = (racine) => lireJour(path.join(racine, 'journal'), JOUR());
const lireArgs = (fichier) => JSON.parse(fs.readFileSync(fichier, 'utf8'));

describe('la boucle du Juge : produire, juger, rejeter, relancer avec les corrections, accepter', () => {
  it('chaque étape attend un clic, le verdict est lu, rien ne repart seul', async () => {
    const { racine, cockpit } = monter();
    try {
      // avant tout travail : rien à vérifier, et le Juge refuse de partir à vide
      assert.equal(verif(cockpit).etat, 'sans_sortie');
      const vide = cockpit.verifier('factures');
      assert.equal(vide.ok, false);
      assert.equal(vide.code, 'rien_a_verifier');
      assert.match(vide.conseil, /^Lance « Factures » d'abord/);

      // 1. Factures produit sa sortie
      await cockpit.lancer('factures').promesse;
      assert.equal(verif(cockpit).etat, 'a_verifier');
      assert.equal(verif(cockpit).texte, 'À vérifier par le Juge');
      assert.equal(verif(cockpit).peut_verifier, true);

      // 2. le Juge est lancé à la main : il REJETTE, avec une correction
      const argsJuge = path.join(racine, 'args-juge.json');
      const passageJuge = await avecEnv({ FAKE_CLAUDE: 'juge_rejette', FAKE_ARGS_FILE: argsJuge, FAKE_COUT: '0.06' }, async () => {
        const l = cockpit.verifier('factures');
        assert.equal(l.ok, true);
        assert.equal(verif(cockpit).etat, 'en_cours', 'pendant le passage : « Le Juge vérifie… »');
        assert.equal(verif(cockpit).texte, 'Le Juge vérifie…');
        return l.promesse;
      });
      assert.equal(passageJuge.agent, 'juge');
      assert.equal(passageJuge.statut, 'reussi');
      assert.equal(passageJuge.cout_eur, 0.0516);
      assert.deepEqual(passageJuge.verification, {
        agent: 'factures',
        sortie: 'out/factures/resultat.md',
        sortie_sha256: createHash('sha256').update('# Résultat simulé de factures\n').digest('hex'),
        verdict: `out/juge/verdict-factures-${JOUR()}-1.md`,
      });
      assert.equal(passageJuge.resultat, passageJuge.verification.verdict, 'le verdict est le fichier produit par le Juge');
      assert.equal(passageJuge.bilan, 'Factures rejeté, 1 correction.', 'la ligne « Bilan : » du verdict est ce que l\'écran dit du Juge');

      // la demande est ajoutée à la consigne du Juge : l'agent, la sortie, le chemin du verdict, les critères de la DoD
      const recu = lireArgs(argsJuge);
      assert.ok(recu.prompt.startsWith('Tu es le Juge de test.\n\n## La demande de ce passage'), 'consigne du fichier, puis la demande');
      assert.match(recu.prompt, /^Agent vérifié : factures$/m);
      assert.match(recu.prompt, /^Sortie jugée : \.\.\/\.\.\/out\/factures\/resultat\.md$/m);
      assert.match(recu.prompt, new RegExp(`^Fichier de verdict à écrire : \\.\\./\\.\\./out/juge/verdict-factures-${JOUR()}-1\\.md$`, 'm'));
      assert.match(recu.prompt, /^2\. Deuxième critère vérifiable\.$/m);
      assert.equal(recu.cwd, fs.realpathSync(path.join(racine, 'agents', 'juge')));

      let v = verif(cockpit);
      assert.equal(v.etat, 'rejete');
      assert.equal(v.texte, 'Rejeté : 1 correction');
      assert.equal(v.peut_relancer, true);
      assert.equal(v.peut_verifier, false);
      assert.deepEqual(v.verdict.criteres.map((c) => c.ok), [true, true, false]);
      assert.equal(v.verdict.corrections[0].texte, 'Corriger le point 3.');
      assert.match(v.verdict.corrections[0].preuve, /ligne 3 du fichier/);

      // un rejet attend une décision humaine : rien ne repart seul, ni l'agent, ni le Juge
      await pause(400);
      assert.equal(cockpit.enCours.size, 0);
      assert.deepEqual(journal(racine).map((e) => e.agent), ['factures', 'juge']);
      assert.deepEqual(cockpit.tickPlanning(), []);
      assert.equal(journal(racine).length, 2);

      // 3. « Relancer avec les corrections » : Factures repart avec les corrections du Juge ajoutées à SA consigne
      const argsFactures = path.join(racine, 'args-factures.json');
      const relance = await avecEnv({ FAKE_ARGS_FILE: argsFactures }, async () => {
        const l = cockpit.relancerAvecCorrections('factures');
        assert.equal(l.ok, true);
        return l.promesse;
      });
      assert.deepEqual(relance.relance_corrections, { verdict: passageJuge.verification.verdict });
      const consigneRelance = lireArgs(argsFactures).prompt;
      assert.ok(consigneRelance.startsWith('Fais le travail.\n\n## Corrections du Juge'), 'sa consigne, puis les corrections');
      assert.match(consigneRelance, /^1\. Corriger le point 3\.\n {3}Preuve : « valeur lue » à la ligne 3 du fichier\.$/m);
      assert.equal(fs.readFileSync(path.join(racine, 'agents', 'factures', 'agent.md'), 'utf8').includes('Corrections du Juge'), false, 'agent.md n\'est jamais modifié');

      // la sortie a changé : l'ancien verdict ne vaut plus, il faut un nouveau clic sur le Juge ; rien n'est lancé seul
      v = verif(cockpit);
      assert.equal(v.etat, 'a_verifier');
      assert.equal(v.detail, 'La sortie a été refaite depuis le dernier verdict.');
      assert.equal(v.peut_relancer, false);
      await pause(300);
      assert.equal(cockpit.enCours.size, 0);
      assert.deepEqual(journal(racine).map((e) => e.agent), ['factures', 'juge', 'factures']);

      // 4. le Juge ACCEPTE : le verdict précédent n'est pas écrasé (numéro 2)
      const accord = await avecEnv({ FAKE_CLAUDE: 'juge_accepte' }, () => cockpit.verifier('factures').promesse);
      assert.equal(accord.verification.verdict, `out/juge/verdict-factures-${JOUR()}-2.md`);
      assert.equal(accord.bilan, 'Factures accepté, 3 critères sur 3.');
      v = verif(cockpit);
      assert.equal(v.etat, 'accepte');
      assert.equal(v.texte, 'Vérifié par le Juge : accepté');
      assert.ok(fs.existsSync(path.join(racine, 'out', 'juge', `verdict-factures-${JOUR()}-1.md`)), 'le rejet reste lisible');
      assert.ok(fs.existsSync(path.join(racine, 'out', 'juge', `verdict-factures-${JOUR()}-2.md`)));
      assert.equal(cockpit.relancerAvecCorrections('factures').code, 'pas_de_rejet', 'plus rien à corriger');
    } finally {
      nettoyer(racine);
    }
  });

  it('une sortie modifiée après le verdict n\'a plus de verdict : le statut repasse à « À vérifier par le Juge »', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      await avecEnv({ FAKE_CLAUDE: 'juge_accepte' }, () => cockpit.verifier('factures').promesse);
      assert.equal(verif(cockpit).etat, 'accepte');
      fs.appendFileSync(path.join(racine, 'out', 'factures', 'resultat.md'), 'modifié après coup\n');
      assert.equal(verif(cockpit).etat, 'a_verifier');
      assert.equal(verif(cockpit).texte, 'À vérifier par le Juge');
    } finally {
      nettoyer(racine);
    }
  });

  it('un rejet à deux corrections : « Rejeté : 2 corrections », les deux avec leur preuve', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      await avecEnv({ FAKE_CLAUDE: 'juge_rejette_deux' }, () => cockpit.verifier('factures').promesse);
      const v = verif(cockpit);
      assert.equal(v.texte, 'Rejeté : 2 corrections');
      assert.deepEqual(v.verdict.corrections.map((c) => c.n), [1, 2]);
      assert.ok(v.verdict.corrections.every((c) => c.preuve !== ''));
      assert.deepEqual(v.verdict.criteres.map((c) => c.ok), [false, true, false]);
    } finally {
      nettoyer(racine);
    }
  });

  it('un verdict mal formé, écrit ailleurs ou absent n\'est jamais pris pour un accord', async () => {
    for (const [scenario, detail] of [['juge_malforme', /manque/], ['juge_ailleurs', /introuvable/], ['juge_muet', /introuvable/]]) {
      const { racine, cockpit } = monter();
      try {
        await cockpit.lancer('factures').promesse;
        const passage = await avecEnv({ FAKE_CLAUDE: scenario }, () => cockpit.verifier('factures').promesse);
        assert.equal(passage.statut, 'reussi', 'le passage du Juge a abouti, c\'est son verdict qui ne vaut rien');
        const v = verif(cockpit);
        assert.equal(v.etat, 'illisible', scenario);
        assert.equal(v.texte, 'Verdict du Juge illisible');
        assert.match(v.detail, detail);
        assert.equal(v.verdict, null);
        assert.equal(v.peut_verifier, true, 'on peut redemander un verdict');
        assert.equal(v.peut_relancer, false, 'sans verdict valable, pas de relance');
        assert.equal(cockpit.relancerAvecCorrections('factures').code, 'pas_de_rejet');
      } finally {
        nettoyer(racine);
      }
    }
  });

  it('un Juge en échec : « Le Juge n\'a pas pu vérifier », l\'alerte du Juge le dit, on peut réessayer', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      await avecEnv({ FAKE_CLAUDE: 'echec' }, () => cockpit.verifier('factures').promesse);
      const v = verif(cockpit);
      assert.equal(v.etat, 'juge_echec');
      assert.equal(v.peut_verifier, true);
      assert.ok(cockpit.etat().alertes.some((a) => a.type === 'echec' && a.agent === 'juge'));
      await avecEnv({ FAKE_CLAUDE: 'juge_accepte' }, () => cockpit.verifier('factures').promesse);
      assert.equal(verif(cockpit).etat, 'accepte');
    } finally {
      nettoyer(racine);
    }
  });
});

describe('le Juge se lance depuis sa propre ligne, et seulement sur demande', () => {
  it('« Lancer » sur le Juge vérifie l\'agent dont la sortie attend un verdict ; sans rien à vérifier, il refuse en disant quoi faire', async () => {
    const { racine, cockpit } = monter();
    try {
      const rien = cockpit.lancer('juge');
      assert.equal(rien.ok, false);
      assert.equal(rien.code, 'rien_a_verifier');
      assert.equal(rien.message, '« Factures » n\'a rien produit à vérifier.');
      assert.match(rien.conseil, /^Lance « Factures » d'abord/);
      assert.equal(journal(racine).length, 0, 'aucun passage');

      await cockpit.lancer('factures').promesse;
      const passage = await avecEnv({ FAKE_CLAUDE: 'juge_accepte' }, () => cockpit.lancer('juge').promesse);
      assert.equal(passage.verification.agent, 'factures');
      assert.equal(verif(cockpit).etat, 'accepte');

      const encore = cockpit.lancer('juge');
      assert.equal(encore.ok, false, 'chaque sortie a déjà son verdict');
      assert.equal(encore.code, 'rien_a_verifier');
      assert.equal(encore.message, 'Chaque sortie vérifiable a déjà son verdict.');
      assert.match(encore.conseil, /^Ouvre le verdict sous l'agent, ou relance l'agent/);
    } finally {
      nettoyer(racine);
    }
  });

  it('« Lancer » sur le Juge dit pourquoi il n\'y a rien à vérifier : aucune definition of done, ou une definition of done illisible', () => {
    const sans = creerProjet({ devis: agentMd({ nom: 'Devis', budget: 5 }), juge: agentMd({ nom: 'Juge', budget: 5, outils: 'Read, Write', prompt: 'Tu es le Juge de test.' }) });
    const illisible = monter({ agents: {} });
    try {
      const aucun = new Cockpit({ racine: sans, config: configTest() }).lancer('juge');
      assert.equal(aucun.code, 'rien_a_verifier');
      assert.equal(aucun.message, 'Aucun agent n\'a de definition of done : le Juge n\'a rien à vérifier.');
      assert.match(aucun.conseil, /^Écris un fichier dod\.md dans le dossier d'un agent \(voir docs\/ecrire-une-dod\.md\)/);
      fs.writeFileSync(path.join(illisible.racine, 'agents', 'factures', 'dod.md'), 'Pas de critère numéroté.');
      const mal = illisible.cockpit.lancer('juge');
      assert.equal(mal.code, 'rien_a_verifier');
      assert.match(mal.message, /^La definition of done de « Factures » est illisible : aucun critère numéroté/);
      assert.match(mal.conseil, /^Corrige agents\/factures\/dod\.md/);
    } finally {
      nettoyer(sans);
      nettoyer(illisible.racine);
    }
  });

  it('jamais seul : ni le planning, ni l\'essai ne le lancent ; un « planning » dans son agent.md le met de côté, avec une alerte', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      fs.writeFileSync(path.join(racine, 'agents', 'juge', 'agent.md'), agentMd({ nom: 'Juge', budget: 5, outils: 'Read, Write', planning: '09:00' }));
      const { agents, invalides } = cockpit.agents();
      assert.ok(!agents.some((a) => a.id === 'juge'));
      assert.equal(invalides.find((i) => i.id === 'juge').erreur, 'le Juge ne se lance qu\'à la main : retire la ligne « planning » de agents/juge/agent.md');
      assert.ok(cockpit.etat().alertes.some((a) => a.type === 'config' && /Le dossier « juge » est ignoré/.test(a.message)));
      assert.equal(cockpit.verifier('factures').code, 'sans_juge');
      assert.deepEqual(cockpit.tickPlanning(), []);
      assert.equal(journal(racine).length, 1);
    } finally {
      nettoyer(racine);
    }
  });

  it('npm run essai ne lance pas le Juge, et le dit', async () => {
    const { racine } = monter();
    try {
      const sortie = [];
      const r = await essai({ racine, config: configTest({ ordre: ['factures', 'juge'] }), afficher: (t) => sortie.push(t) });
      assert.deepEqual(r.resultats.map((x) => x.agent_nom), ['Factures']);
      const texte = sortie.join('\n');
      assert.match(texte, /Essai : 1 agent, un passage chacun/);
      assert.match(texte, /Le Juge n'est pas lancé par l'essai/);
      assert.deepEqual(journal(racine).map((e) => e.agent), ['factures']);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('les refus : ce qui ne peut pas être vérifié le dit, avec un conseil', () => {
  const agentsEnPlus = { devis: agentMd({ nom: 'Devis', budget: 5 }), avis: agentMd({ nom: 'Avis', budget: 5 }) };

  it('agent inconnu, le Juge lui-même, agent sans dod.md, dod.md illisible', async () => {
    const { racine, cockpit } = monter({ agents: agentsEnPlus });
    try {
      await cockpit.lancer('devis').promesse;
      assert.equal(cockpit.verifier('nimporte').code, 'inconnu');
      assert.equal(cockpit.verifier('juge').code, 'juge_sur_juge');
      const sansDod = cockpit.verifier('devis');
      assert.equal(sansDod.code, 'sans_dod');
      assert.match(sansDod.message, /« Devis » n'a pas de definition of done/);
      assert.match(sansDod.conseil, /^Écris agents\/devis\/dod\.md \(3 à 5 critères numérotés\)/);
      fs.writeFileSync(path.join(racine, 'agents', 'avis', 'dod.md'), 'Pas de critère numéroté.');
      await cockpit.lancer('avis').promesse;
      const illisible = cockpit.verifier('avis');
      assert.equal(illisible.code, 'dod_illisible');
      assert.match(illisible.conseil, /^Corrige agents\/avis\/dod\.md : aucun critère numéroté/);
      assert.equal(cockpit.etat().agents.find((a) => a.id === 'devis').verification, null, 'sans dod.md : aucune ligne de vérification');
      assert.equal(cockpit.etat().agents.find((a) => a.id === 'avis').verification.etat, 'dod_illisible');
      assert.equal(journal(racine).filter((e) => e.agent === 'juge').length, 0, 'le Juge n\'est jamais parti');
    } finally {
      nettoyer(racine);
    }
  });

  it('pas d\'agent Juge dans le dossier : le message dit comment le créer', () => {
    const racine = creerProjet({ factures: agentMd({ nom: 'Factures' }) });
    try {
      fs.writeFileSync(path.join(racine, 'agents', 'factures', 'dod.md'), DOD);
      const r = new Cockpit({ racine, config: configTest() }).verifier('factures');
      assert.equal(r.code, 'sans_juge');
      assert.match(r.conseil, /^Crée agents\/juge\/agent\.md/);
    } finally {
      nettoyer(racine);
    }
  });

  it('la sortie à juger a disparu : rien à vérifier', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      fs.rmSync(path.join(racine, 'out', 'factures'), { recursive: true });
      assert.equal(cockpit.verifier('factures').code, 'rien_a_verifier');
    } finally {
      nettoyer(racine);
    }
  });

  it('« Relancer avec les corrections » sans rejet à jour : refusé', async () => {
    const { racine, cockpit } = monter();
    try {
      assert.equal(cockpit.relancerAvecCorrections('nimporte').code, 'inconnu');
      assert.equal(cockpit.relancerAvecCorrections('factures').code, 'pas_de_rejet');
      await cockpit.lancer('factures').promesse;
      const r = cockpit.relancerAvecCorrections('factures');
      assert.equal(r.code, 'pas_de_rejet');
      assert.match(r.conseil, /^Lance le Juge sur « Factures »/);
      assert.equal(journal(racine).length, 1);
    } finally {
      nettoyer(racine);
    }
  });

  it('le Juge est déjà en cours : un second lancement est refusé, comme pour tout agent', async () => {
    const { racine, cockpit } = monter();
    try {
      await cockpit.lancer('factures').promesse;
      await avecEnv({ FAKE_CLAUDE: 'juge_accepte' }, async () => {
        const premier = cockpit.verifier('factures');
        assert.equal(premier.ok, true);
        const second = cockpit.verifier('factures');
        assert.equal(second.ok, false);
        assert.equal(second.code, 'deja_en_cours');
        assert.equal(verif(cockpit).peut_verifier, false);
        await premier.promesse;
      });
    } finally {
      nettoyer(racine);
    }
  });
});

describe('le coût du Juge compte dans le budget, comme celui des autres', () => {
  it('son coût s\'ajoute au coût du jour et à la ligne du Juge ; son budget le bloque ensuite, avec le même message qu\'un autre agent', async () => {
    const { racine, cockpit } = monter({ budgetJuge: 0.5, config: { plafond_jour_eur: 5 } });
    try {
      await avecEnv({ FAKE_COUT: '0.1' }, () => cockpit.lancer('factures').promesse);
      const passage = await avecEnv({ FAKE_CLAUDE: 'juge_rejette', FAKE_COUT: '0.5' }, () => cockpit.verifier('factures').promesse);
      assert.equal(passage.cout_eur, 0.43);

      const etat = cockpit.etat();
      const carteJuge = etat.agents.find((a) => a.id === 'juge');
      assert.equal(carteJuge.cout_jour_eur, 0.43);
      assert.equal(carteJuge.budget_jour_eur, 0.5);
      assert.equal(etat.cout.jour_eur, 0.516, 'Factures (0,086 €) et Juge (0,43 €) dans le coût du jour');
      assert.equal(etat.cout.taches_jour, 2);
      assert.equal(carteJuge.fait, 'Factures rejeté, 1 correction.', 'ce que le Juge a fait aujourd\'hui, en une ligne, sur sa ligne');

      // 0,43 € déjà dépensés + 0,43 € d'estimation > 0,50 € : le Juge ne repart pas, et le refus est journalisé comme pour les autres
      const refus = cockpit.verifier('factures');
      assert.equal(refus.ok, false);
      assert.equal(refus.code, 'budget');
      assert.match(refus.message, /^Juge non lancé : il dépasserait son budget du jour \(0,50 €\)\. Déjà compté : 0,43 €/);
      assert.match(refus.conseil, /^Relève le budget de « Juge » dans son agent\.md/);
      const dernier = journal(racine).at(-1);
      assert.equal(dernier.agent, 'juge');
      assert.equal(dernier.statut, 'bloque_budget');
      assert.ok(cockpit.etat().alertes.some((a) => a.type === 'budget' && a.agent === 'juge'));
    } finally {
      nettoyer(racine);
    }
  });

  it('le plafond du jour compte aussi le Juge', async () => {
    const { racine, cockpit } = monter({ config: { plafond_jour_eur: 0.4, estimation_defaut_eur: 0.15 } });
    try {
      await avecEnv({ FAKE_COUT: '0.2' }, () => cockpit.lancer('factures').promesse); // 0,172 €
      // le Juge part : 0,172 € déjà dépensés + 0,15 € d'estimation = 0,322 €, sous le plafond de 0,40 €
      await avecEnv({ FAKE_CLAUDE: 'juge_accepte', FAKE_COUT: '0.25' }, () => cockpit.verifier('factures').promesse); // 0,215 €
      // sans le coût du Juge, un second passage de Factures tiendrait (0,172 + 0,172 = 0,344 €) ; avec lui (0,387 + 0,172 €), non
      const l = cockpit.lancer('factures');
      assert.equal(l.ok, false);
      assert.equal(l.code, 'budget');
      assert.match(l.message, /il dépasserait le plafond du jour \(0,40 €\)/);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('sécurité : le Juge a le même modèle que les autres agents', () => {
  const jugeLivre = lireAgentMd(fs.readFileSync(path.join(RACINE_REELLE, 'agents', 'juge', 'agent.md'), 'utf8'), 'juge');
  const commande = construireCommande(jugeLivre, configTest(), RACINE_REELLE);
  const apres = (drapeau) => commande.args[commande.args.indexOf(drapeau) + 1];

  it('outils limités à Read et Write, écriture limitée à out/juge/, rien d\'autre d\'autorisé', () => {
    assert.equal(apres('--tools'), 'Read,Write');
    const dossier = path.join(fs.realpathSync(RACINE_REELLE), 'out', 'juge');
    assert.equal(apres('--allowedTools'), `Edit(/${dossier}/**)`, 'une seule autorisation : écrire dans out/juge/');
    assert.equal(apres('--permission-mode'), 'dontAsk');
    for (const interdit of ['Bash', 'WebFetch', 'WebSearch', 'mcp__', '--dangerously-skip-permissions', 'bypassPermissions', '--bare']) {
      assert.ok(!commande.args.join(' ').includes(interdit), `« ${interdit} » ne doit pas figurer dans la commande du Juge`);
    }
  });

  it('configuration isolée : aucun MCP ni connecteur, aucun réglage personnel, aucune skill, aucune mémoire', () => {
    assert.ok(commande.args.includes('--strict-mcp-config'));
    assert.ok(commande.args.includes('--disable-slash-commands'));
    assert.equal(apres('--setting-sources'), 'project');
    assert.deepEqual(JSON.parse(apres('--settings')), { claudeMdExcludes: ['**/CLAUDE.md'] });
    assert.equal(commande.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.ok(commande.args.includes('--no-session-persistence'));
  });

  it('même avec « configuration_isolee »: false, le Juge garde --strict-mcp-config (aucun connecteur du compte) ; les autres agents gardent le comportement documenté', () => {
    const complete = construireCommande(jugeLivre, configTest({ configuration_isolee: false }), RACINE_REELLE);
    assert.equal(complete.args.filter((a) => a === '--strict-mcp-config').length, 1, 'une seule fois, jamais deux');
    for (const drapeau of ['--setting-sources', '--settings', '--disable-slash-commands']) assert.ok(!complete.args.includes(drapeau), `${drapeau} reste réservé à la configuration isolée`);
    assert.notEqual(complete.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.equal(apres('--tools'), 'Read,Write', 'ses outils ne changent pas');
    // un autre agent, en configuration complète, n'a aucune de ces options
    const factures = lireAgentMd(fs.readFileSync(path.join(RACINE_REELLE, 'agents', 'factures', 'agent.md'), 'utf8'), 'factures');
    assert.ok(!construireCommande(factures, configTest({ configuration_isolee: false }), RACINE_REELLE).args.includes('--strict-mcp-config'));
    // et en configuration isolée, le Juge l'a une seule fois
    const isolee = construireCommande(jugeLivre, configTest({ configuration_isolee: true }), RACINE_REELLE);
    assert.equal(isolee.args.filter((a) => a === '--strict-mcp-config').length, 1);
    assert.equal(isolee.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  });

  it('il lit data/ et out/ (la sortie jugée et ses sources), travaille dans son dossier, jamais ailleurs', () => {
    const reel = fs.realpathSync(RACINE_REELLE);
    assert.deepEqual(commande.args.filter((a, i) => commande.args[i - 1] === '--add-dir'), [path.join(reel, 'data'), path.join(reel, 'out')]);
    assert.equal(commande.cwd, path.join(reel, 'agents', 'juge'));
    assert.equal(commande.sortie, path.join(reel, 'out', 'juge'));
  });

  it('son nombre de tours est limité', () => {
    assert.equal(apres('--max-turns'), String(jugeLivre.max_tours));
    assert.ok(jugeLivre.max_tours <= 15);
  });
});

describe('les routes du serveur : lancer le Juge, relancer avec les corrections', () => {
  const ouverts = [];
  after(async () => {
    for (const fin of ouverts) await fin();
  });

  async function demarrer() {
    const { racine, cockpit } = monter();
    const cfg = configTest();
    await cockpit.initialiser();
    const serveur = await demarrerServeur({ cockpit, config: cfg, racine, intervalleEtatMs: 150 });
    ouverts.push(async () => {
      await cockpit.arreter();
      await serveur.fermer();
      nettoyer(racine);
    });
    return { racine, cockpit, base: `http://127.0.0.1:${serveur.port}` };
  }
  const poster = (base, chemin, entetes = { 'X-Cockpit': '1' }) => fetch(`${base}${chemin}`, { method: 'POST', headers: entetes });

  it('mêmes protections que « Lancer » : l\'en-tête X-Cockpit et une origine locale sont exigés', async () => {
    const { base, racine } = await demarrer();
    for (const chemin of ['/api/agents/factures/verifier', '/api/agents/factures/relancer-avec-corrections', '/api/agents/juge/lancer']) {
      const sans = await poster(base, chemin, {});
      assert.equal(sans.status, 403, chemin);
      const etrangere = await poster(base, chemin, { 'X-Cockpit': '1', Origin: 'https://exemple.org' });
      assert.equal(etrangere.status, 403, chemin);
      const get = await fetch(`${base}${chemin}`);
      assert.equal(get.status, 404, 'seulement en POST');
    }
    assert.equal(journal(racine).length, 0, 'rien n\'a tourné');
  });

  it('rien à vérifier : 409 avec le code et le conseil ; agent inconnu : 404 ; pas de rejet : 409', async () => {
    const { base } = await demarrer();
    const rien = await poster(base, '/api/agents/factures/verifier');
    assert.equal(rien.status, 409);
    const corps = await rien.json();
    assert.equal(corps.ok, false);
    assert.equal(corps.code, 'rien_a_verifier');
    assert.match(corps.conseil, /^Lance « Factures » d'abord/);
    assert.equal((await poster(base, '/api/agents/nimporte/verifier')).status, 404);
    assert.equal((await poster(base, '/api/agents/nimporte/relancer-avec-corrections')).status, 404);
    const pasDeRejet = await poster(base, '/api/agents/factures/relancer-avec-corrections');
    assert.equal(pasDeRejet.status, 409);
    assert.equal((await pasDeRejet.json()).code, 'pas_de_rejet');
    const juge = await poster(base, '/api/agents/juge/lancer');
    assert.equal(juge.status, 409, 'le Juge sur sa ligne, sans rien à vérifier');
    assert.equal((await juge.json()).code, 'rien_a_verifier');
  });

  it('le chemin complet par le serveur : lancer Factures, lancer le Juge (202), lire le rejet dans /api/etat, relancer (202)', async () => {
    const { base, cockpit } = await demarrer();
    assert.equal((await poster(base, '/api/agents/factures/lancer')).status, 202);
    await cockpit.enCours.get('factures')?.promesse;
    const lancement = await avecEnv({ FAKE_CLAUDE: 'juge_rejette' }, async () => {
      const r = await poster(base, '/api/agents/factures/verifier');
      await cockpit.enCours.get('juge')?.promesse;
      return r;
    });
    assert.equal(lancement.status, 202);
    assert.deepEqual(await lancement.json(), { ok: true, agent: 'juge' });
    const etat = await (await fetch(`${base}/api/etat`)).json();
    const factures = etat.agents.find((a) => a.id === 'factures');
    assert.equal(factures.verification.etat, 'rejete');
    assert.equal(factures.verification.texte, 'Rejeté : 1 correction');
    assert.equal(etat.agents.find((a) => a.id === 'devis'), undefined);
    // le verdict s'ouvre en texte brut, comme tout résultat
    const brut = await fetch(`${base}/${factures.verification.verdict.chemin}`);
    assert.equal(brut.status, 200);
    assert.match(brut.headers.get('content-type'), /^text\/plain/);
    assert.match(await brut.text(), /^Verdict : REJETÉ$/m);
    const relance = await poster(base, '/api/agents/factures/relancer-avec-corrections');
    assert.equal(relance.status, 202);
    assert.deepEqual(await relance.json(), { ok: true, agent: 'factures' });
    await cockpit.enCours.get('factures')?.promesse;
  });
});

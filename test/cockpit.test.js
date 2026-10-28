import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Cockpit, detecterClaude } from '../src/cockpit.js';
import { estAbonnement } from '../src/etat.js';
import { lireJour } from '../src/journal.js';
import { jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, date, nettoyer } from './aide.js';

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

/** Un cockpit sur un faux projet, avec une horloge qu'on peut régler. */
function monter(agents, config = {}, heure = date(9, 0)) {
  const racine = creerProjet(agents);
  const horloge = { maintenant: heure };
  const cockpit = new Cockpit({ racine, config: configTest(config), maintenant: () => horloge.maintenant });
  return { racine, cockpit, horloge };
}
const journalDuJour = (racine, horloge) => lireJour(path.join(racine, 'journal'), jourLocal(horloge.maintenant));

describe('lancement et budgets', () => {
  it('lance un agent, écrit le journal, et l\'état reflète le coût réel', async () => {
    const { racine, cockpit, horloge } = monter({ alpha: agentMd({ budget: 1 }) });
    try {
      const lignes = [];
      cockpit.on('ligne', (l) => lignes.push(l));
      const r = await avecEnv({ FAKE_COUT: '0.2' }, async () => {
        const lancement = cockpit.lancer('alpha');
        assert.equal(lancement.ok, true);
        assert.ok(cockpit.enCours.has('alpha'));
        assert.equal(cockpit.etat().agents[0].statut, 'en_cours');
        return lancement.promesse;
      });
      assert.equal(r.cout_eur, 0.172);
      assert.equal(journalDuJour(racine, horloge).length, 1);
      assert.ok(!cockpit.enCours.has('alpha'));

      const etat = cockpit.etat();
      assert.equal(etat.agents[0].statut, 'reussi');
      assert.equal(etat.agents[0].cout_jour_eur, 0.172);
      assert.equal(etat.cout.jour_eur, 0.172);
      assert.equal(etat.cout.reste_eur, 2.828);
      assert.equal(etat.historique[0].resultat, 'out/alpha/resultat.md');
      assert.deepEqual(etat.alertes, []);
      assert.ok(lignes.every((l) => l.agent === 'alpha' && l.agent_nom === 'Agent de test'));
      assert.ok(lignes.some((l) => l.texte === 'Lit data/lisez-moi.txt'));
    } finally {
      nettoyer(racine);
    }
  });

  it('budget dépassé : l\'agent ne se lance pas, le refus est journalisé et une alerte s\'affiche', async () => {
    const { racine, cockpit, horloge } = monter({ alpha: agentMd({ budget: 0.1 }) }, { estimation_defaut_eur: 0.05 });
    try {
      const premier = await avecEnv({ FAKE_COUT: '0.5' }, () => cockpit.lancer('alpha').promesse); // 0,43 € > budget de 0,10 €
      assert.equal(premier.statut, 'reussi');
      const refus = cockpit.lancer('alpha');
      assert.equal(refus.ok, false);
      assert.equal(refus.code, 'budget');
      assert.match(refus.message, /^Agent de test non lancé : il dépasserait son budget du jour/);
      assert.match(refus.conseil, /^Relève le budget de « Agent de test »/, 'la bulle commence par un verbe');
      assert.ok(!cockpit.enCours.has('alpha'), 'aucun processus lancé');

      const journal = journalDuJour(racine, horloge);
      assert.equal(journal.length, 2);
      assert.equal(journal[1].statut, 'bloque_budget');
      assert.equal(journal[1].cout_eur, 0);

      const etat = cockpit.etat();
      assert.equal(etat.agents[0].statut, 'bloque_budget');
      assert.equal(etat.alertes.length, 1);
      assert.equal(etat.alertes[0].type, 'budget');
      assert.equal(etat.historique[0].statut, 'bloque_budget');
    } finally {
      nettoyer(racine);
    }
  });

  it('le plafond du jour bloque aussi, et compte les passages déjà en cours', async () => {
    const { racine, cockpit } = monter(
      { alpha: agentMd({ budget: 1 }), beta: agentMd({ budget: 1, nom: 'Beta' }) },
      { plafond_jour_eur: 0.2, estimation_defaut_eur: 0.15 },
    );
    try {
      const a = await avecEnv({ FAKE_CLAUDE: 'lent' }, async () => {
        const lancement = cockpit.lancer('alpha'); // 0 + 0,15 <= 0,2 : accepté
        assert.equal(lancement.ok, true);
        const b = cockpit.lancer('beta'); // 0 + 0,15 engagés + 0,15 > 0,2 : refusé
        assert.equal(b.ok, false);
        assert.equal(b.code, 'budget');
        assert.match(b.message, /il dépasserait le plafond du jour/);
        return lancement.promesse;
      });
      assert.equal(a.statut, 'reussi');
    } finally {
      nettoyer(racine);
    }
  });

  it('un échec produit une alerte, qui disparaît après un passage réussi', async () => {
    const { racine, cockpit, horloge } = monter({ alpha: agentMd({ budget: 5 }) });
    try {
      await avecEnv({ FAKE_CLAUDE: 'echec' }, () => cockpit.lancer('alpha').promesse);
      let etat = cockpit.etat();
      assert.equal(etat.agents[0].statut, 'echec');
      assert.equal(etat.alertes[0].type, 'echec');
      assert.match(etat.alertes[0].message, /Agent de test a échoué à 09:00 : panne simulée/);

      horloge.maintenant = date(9, 5);
      await cockpit.lancer('alpha').promesse;
      etat = cockpit.etat();
      assert.equal(etat.agents[0].statut, 'reussi');
      assert.deepEqual(etat.alertes, []);
    } finally {
      nettoyer(racine);
    }
  });

  it('refuse un second lancement pendant qu\'un passage est en cours, un agent inconnu et un agent illisible', async () => {
    const { racine, cockpit } = monter({ alpha: agentMd({ budget: 5 }), casse: 'pas un agent' });
    try {
      const encore = await avecEnv({ FAKE_CLAUDE: 'lent' }, async () => {
        const premier = cockpit.lancer('alpha');
        assert.equal(cockpit.lancer('alpha').code, 'deja_en_cours');
        return premier.promesse;
      });
      assert.equal(encore.statut, 'reussi');
      assert.equal(cockpit.lancer('fantome').code, 'inconnu');
      const illisible = cockpit.lancer('casse');
      assert.equal(illisible.code, 'agent_invalide');
      assert.match(illisible.message, /commencer par une ligne « --- »/);
      const etat = cockpit.etat();
      assert.equal(etat.agents.find((a) => a.id === 'casse').invalide, true);
      assert.ok(etat.alertes.some((a) => a.type === 'config' && a.agent === 'casse'));
    } finally {
      nettoyer(racine);
    }
  });

  it('arrêter le cockpit interrompt les passages en cours et les journalise', async () => {
    const { racine, cockpit, horloge } = monter({ alpha: agentMd({ budget: 5 }) });
    try {
      await avecEnv({ FAKE_CLAUDE: 'silence' }, async () => {
        assert.equal(cockpit.lancer('alpha').ok, true);
        await new Promise((r) => setTimeout(r, 300));
        await cockpit.arreter();
      });
      const journal = journalDuJour(racine, horloge);
      assert.equal(journal.length, 1);
      assert.equal(journal[0].statut, 'echec');
      assert.match(journal[0].erreur, /cockpit a été arrêté/);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('passage interrompu : coût inconnu', () => {
  it('l\'écran dit « coût inconnu », le budget du jour compte l\'estimation prudente, le coût réel reste intact', async () => {
    const { racine, cockpit, horloge } = monter({ alpha: agentMd({ budget: 1 }) }, { estimation_defaut_eur: 0.15 });
    try {
      const r = await avecEnv({ FAKE_CLAUDE: 'sans_result' }, () => cockpit.lancer('alpha').promesse);
      assert.equal(r.statut, 'echec');
      assert.equal(r.cout_eur, null);
      assert.equal(r.cout_estime_eur, 0.15);
      const etat = cockpit.etat();
      assert.equal(etat.cout.jour_eur, 0, 'aucun coût réel : la coupure ne produit pas de faux chiffre');
      assert.equal(etat.cout.estime_eur, 0.15);
      assert.equal(etat.cout.passages_inconnus, 1);
      assert.equal(etat.cout.reste_eur, 2.85, 'le reste compte l\'estimation : 3 - 0,15');
      assert.equal(etat.historique[0].cout_eur, null);
      assert.equal(etat.agents[0].cout_estime_eur, 0.15);
      assert.equal(journalDuJour(racine, horloge)[0].cout_estime_eur, 0.15);
    } finally {
      nettoyer(racine);
    }
  });

  it('plusieurs coupures successives finissent par bloquer l\'agent : le budget n\'est pas contournable', async () => {
    const { racine, cockpit } = monter({ alpha: agentMd({ budget: 0.4 }) }, { estimation_defaut_eur: 0.15 });
    try {
      let statuts = [];
      await avecEnv({ FAKE_CLAUDE: 'sans_result' }, async () => {
        for (let i = 0; i < 4; i += 1) {
          const r = cockpit.lancer('alpha');
          statuts.push(r.ok ? 'lancé' : r.code);
          if (r.ok) await r.promesse;
        }
      });
      // 0 + 0,15 <= 0,40 ; 0,15 + 0,15 <= 0,40 ; 0,30 + 0,15 > 0,40 : refusé
      assert.deepEqual(statuts, ['lancé', 'lancé', 'budget', 'budget']);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('planificateur', () => {
  it('lance l\'agent à son heure, une seule fois, et pas avant', async () => {
    const { racine, cockpit, horloge } = monter({ veille: agentMd({ nom: 'Veille', planning: '07:30', budget: 5 }) }, {}, date(7, 29));
    try {
      assert.deepEqual(cockpit.tickPlanning(), [], 'trop tôt');
      horloge.maintenant = date(7, 30);
      assert.deepEqual(cockpit.tickPlanning(), ['veille']);
      assert.deepEqual(cockpit.tickPlanning(), [], 'déjà en cours');
      await cockpit.enCours.get('veille').promesse;
      horloge.maintenant = date(7, 31);
      assert.deepEqual(cockpit.tickPlanning(), [], 'déjà passé');
      const journal = journalDuJour(racine, horloge);
      assert.equal(journal.length, 1);
      assert.equal(journal[0].declencheur, 'planning');
      assert.deepEqual(cockpit.etat().alertes, []);
    } finally {
      nettoyer(racine);
    }
  });

  it('serveur démarré trop tard : pas de lancement surprise, une alerte « en retard » et le prochain passage demain', () => {
    const { racine, cockpit } = monter({ veille: agentMd({ nom: 'Veille', planning: '07:30', budget: 5 }) }, {}, date(14, 0));
    try {
      assert.deepEqual(cockpit.tickPlanning(), []);
      const etat = cockpit.etat();
      assert.equal(etat.agents[0].en_retard, true);
      assert.equal(etat.agents[0].prochain_jour, 'demain');
      assert.equal(etat.alertes.length, 1);
      assert.equal(etat.alertes[0].type, 'retard');
      assert.equal(etat.alertes[0].message, 'Veille n\'a pas tourné à 07:30 : le cockpit n\'était pas lancé à cette heure (démarré à 14:00).');
      assert.equal(etat.agents[0].statut, 'pret');
    } finally {
      nettoyer(racine);
    }
  });

  it('un lancement planifié refusé par le budget est journalisé une seule fois, sans boucle', () => {
    const { racine, cockpit, horloge } = monter(
      { veille: agentMd({ nom: 'Veille', planning: '07:30', budget: 0.01 }) },
      { estimation_defaut_eur: 0.15 },
      date(7, 30),
    );
    try {
      assert.deepEqual(cockpit.tickPlanning(), ['veille']);
      assert.deepEqual(cockpit.tickPlanning(), []);
      const journal = journalDuJour(racine, horloge);
      assert.equal(journal.length, 1);
      assert.equal(journal[0].statut, 'bloque_budget');
      assert.equal(journal[0].declencheur, 'planning');
      const etat = cockpit.etat();
      assert.deepEqual(etat.alertes.map((a) => a.type), ['budget'], 'une alerte de budget, pas de retard en plus');
    } finally {
      nettoyer(racine);
    }
  });
});

describe('détection de Claude Code', () => {
  it('lit la version et le mode de connexion, rien d\'autre', async () => {
    const info = await detecterClaude(configTest());
    assert.deepEqual(info, { ok: true, version: '2.1.999', connecte: true, auth: 'claude.ai', erreur: null });
    assert.equal(estAbonnement(configTest(), info), true);
  });

  it('abonnement : « équivalent API » seulement si la connexion est un abonnement (ou si le réglage le force)', () => {
    assert.equal(estAbonnement(configTest(), { auth: 'api_key' }), false);
    assert.equal(estAbonnement(configTest(), { auth: null }), null);
    assert.equal(estAbonnement(configTest({ abonnement: 'oui' }), { auth: 'api_key' }), true);
    assert.equal(estAbonnement(configTest({ abonnement: 'non' }), { auth: 'claude.ai' }), false);
  });

  it('claude absent ou non connecté : un message qui dit quoi faire', async () => {
    const absent = await detecterClaude(configTest({ commande_claude: '/chemin/inexistant/claude' }));
    assert.equal(absent.ok, false);
    assert.match(absent.erreur, /introuvable.*Installe-le/);
    const deconnecte = await avecEnv({ FAKE_CLAUDE: 'deconnecte' }, () => detecterClaude(configTest()));
    assert.equal(deconnecte.ok, true);
    assert.equal(deconnecte.connecte, false);
    const { racine, cockpit } = monter({ alpha: agentMd() });
    try {
      cockpit.claude = deconnecte;
      assert.match(cockpit.etat().alertes[0].message, /claude auth login/);
      cockpit.claude = absent;
      assert.equal(cockpit.etat().alertes[0].type, 'config');
    } finally {
      nettoyer(racine);
    }
  });
});

describe('dossier de sortie', () => {
  it('chaque agent écrit dans out/<son id>/ et nulle part ailleurs', async () => {
    const { racine, cockpit } = monter({ alpha: agentMd({ budget: 5 }), beta: agentMd({ nom: 'Beta', budget: 5 }) });
    try {
      await cockpit.lancer('alpha').promesse;
      await cockpit.lancer('beta').promesse;
      assert.deepEqual(fs.readdirSync(path.join(racine, 'out')).sort(), ['alpha', 'beta']);
      assert.deepEqual(fs.readdirSync(path.join(racine, 'out', 'alpha')), ['resultat.md']);
    } finally {
      nettoyer(racine);
    }
  });
});

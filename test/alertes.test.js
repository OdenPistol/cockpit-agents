import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculerAlertes, prochainPassage, statutPlanning } from '../src/alertes.js';
import { isoLocal } from '../src/utilitaires.js';
import { configTest, date, entree } from './aide.js';

const config = configTest({ plafond_jour_eur: 3, estimation_defaut_eur: 0.15, tolerance_retard_min: 3 });
const veille = { id: 'veille', nom: 'Veille', planning: '07:30', budget_jour_eur: 0.5 };
const manuel = { id: 'manuel', nom: 'Manuel', planning: null, budget_jour_eur: 0.5 };
const vide = new Map();
const par = (agent, entrees, maintenant, enCours = vide) =>
  statutPlanning({ agent, entrees, maintenant, enCours, tolerance_min: 3 }).etat;
const passage = (agent, h, m, fin = null, surcharges = {}) => entree({
  agent, agent_nom: agent, debut: isoLocal(date(h, m)), fin: isoLocal(fin ?? date(h, m + 1)), ...surcharges,
});

describe('alerte « en retard »', () => {
  it('nominal : l\'heure prévue + la tolérance est passée et l\'agent n\'a pas tourné → alerte', () => {
    const maintenant = date(7, 34);
    assert.equal(par(veille, [], maintenant), 'en_retard');
    const alertes = calculerAlertes({ agents: [veille], entrees: [], maintenant, enCours: vide, config });
    assert.equal(alertes.length, 1);
    assert.equal(alertes[0].type, 'retard');
    assert.equal(alertes[0].agent, 'veille');
    assert.match(alertes[0].message, /^Veille n'a pas tourné à 07:30 : /);
  });

  it('cas limite : pile à la fin de la tolérance, c\'est le retard (07:33 pour 07:30 + 3 min)', () => {
    assert.equal(par(veille, [], date(7, 32)), 'dans_la_fenetre');
    assert.equal(par(veille, [], date(7, 33)), 'en_retard');
  });

  it('avant l\'heure, et pendant la tolérance : pas d\'alerte (le planificateur va lancer l\'agent)', () => {
    for (const maintenant of [date(7, 0), date(7, 29), date(7, 30), date(7, 31)]) {
      assert.deepEqual(calculerAlertes({ agents: [veille], entrees: [], maintenant, enCours: vide, config }), []);
    }
    assert.equal(par(veille, [], date(7, 29)), 'a_venir');
    assert.equal(par(veille, [], date(7, 30)), 'dans_la_fenetre');
  });

  it('l\'autre sens : l\'agent est bien passé → plus d\'alerte, même longtemps après', () => {
    const entrees = [passage('veille', 7, 31)];
    assert.equal(par(veille, entrees, date(18, 0)), 'fait');
    assert.deepEqual(calculerAlertes({ agents: [veille], entrees, maintenant: date(18, 0), enCours: vide, config }), []);
  });

  it('un passage commencé AVANT l\'heure prévue et terminé avant ne la couvre pas', () => {
    const entrees = [passage('veille', 7, 0)]; // 07:00 → 07:01
    assert.equal(par(veille, entrees, date(7, 40)), 'en_retard');
  });

  it('un passage commencé avant l\'heure prévue mais terminé après la couvre', () => {
    const entrees = [passage('veille', 7, 29, date(7, 31))];
    assert.equal(par(veille, entrees, date(7, 40)), 'fait');
  });

  it('un agent en cours n\'est pas en retard', () => {
    const enCours = new Map([['veille', { debut: isoLocal(date(7, 31)) }]]);
    assert.equal(par(veille, [], date(8, 0), enCours), 'en_cours');
  });

  it('un lancement refusé par le budget à l\'heure prévue compte comme une tentative (pas de double alerte)', () => {
    const entrees = [passage('veille', 7, 30, date(7, 30), { statut: 'bloque_budget', cout_eur: 0, cout_usd: 0, erreur: 'refusé' })];
    assert.equal(par(veille, entrees, date(9, 0)), 'fait');
  });

  it('un agent sans planning n\'est jamais en retard', () => {
    assert.equal(par(manuel, [], date(23, 59)), 'sans_planning');
    assert.deepEqual(calculerAlertes({ agents: [manuel], entrees: [], maintenant: date(23, 59), enCours: vide, config }), []);
  });

  it('un passage d\'hier ne couvre pas le planning d\'aujourd\'hui', () => {
    const entrees = [entree({ agent: 'veille', debut: isoLocal(date(7, 31, 20)), fin: isoLocal(date(7, 32, 20)) })];
    assert.equal(par(veille, entrees, date(9, 0)), 'en_retard');
  });

  it('une heure prévue juste après minuit', () => {
    const nuit = { id: 'nuit', nom: 'Nuit', planning: '00:05', budget_jour_eur: 1 };
    assert.equal(par(nuit, [], date(0, 4)), 'a_venir');
    assert.equal(par(nuit, [], date(0, 10)), 'en_retard');
  });
});

describe('prochain passage', () => {
  it('aujourd\'hui tant que l\'heure n\'est pas passée, puis demain', () => {
    const avant = prochainPassage({ agent: veille, entrees: [], maintenant: date(7, 0), enCours: vide, tolerance_min: 3 });
    assert.equal(avant.jour, 'aujourdhui');
    assert.equal(isoLocal(avant.quand).slice(0, 16), '2026-10-21T07:30');
    const apres = prochainPassage({ agent: veille, entrees: [passage('veille', 7, 31)], maintenant: date(9, 0), enCours: vide, tolerance_min: 3 });
    assert.equal(apres.jour, 'demain');
    assert.equal(isoLocal(apres.quand).slice(0, 16), '2026-10-22T07:30');
  });

  it('pas de prochain passage sans planning', () => {
    assert.equal(prochainPassage({ agent: manuel, entrees: [], maintenant: date(9, 0), enCours: vide, tolerance_min: 3 }), null);
  });
});

describe('alerte de budget', () => {
  const agent = { id: 'alpha', nom: 'Alpha', planning: null, budget_jour_eur: 0.5 };
  const refus = (h, m) => entree({
    debut: isoLocal(date(h, m)), fin: isoLocal(date(h, m)), statut: 'bloque_budget', cout_eur: 0, cout_usd: 0, erreur: 'refusé',
  });

  it('nominal : un lancement refusé, budget toujours dépassé → alerte qui dit pourquoi', () => {
    const entrees = [entree({ cout_eur: 0.4 }), refus(9, 0)];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 1), enCours: vide, config });
    assert.equal(alertes.length, 1);
    assert.equal(alertes[0].type, 'budget');
    assert.match(alertes[0].message, /^Alpha non lancé à 09:00 : il dépasserait son budget du jour \(0,50 €\)\. Déjà compté : 0,40 €/);
  });

  it('l\'autre sens : budget relevé depuis le refus → l\'alerte disparaît', () => {
    const entrees = [entree({ cout_eur: 0.4 }), refus(9, 0)];
    const releve = { ...agent, budget_jour_eur: 2 };
    assert.deepEqual(calculerAlertes({ agents: [releve], entrees, maintenant: date(9, 1), enCours: vide, config }), []);
  });

  it('refus par le plafond du jour : l\'alerte le dit', () => {
    const entrees = [entree({ agent: 'beta', cout_eur: 2.95, debut: isoLocal(date(8, 0)) }), refus(9, 0)];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 1), enCours: vide, config });
    assert.equal(alertes[0].type, 'budget');
    assert.match(alertes[0].message, /il dépasserait le plafond du jour \(3,00 €\)/);
  });

  it('dépassement constaté après coup (un passage en cours n\'est pas coupé) → alerte', () => {
    const entrees = [entree({ cout_eur: 0.62 })];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 1), enCours: vide, config });
    assert.equal(alertes.length, 1);
    assert.match(alertes[0].message, /a dépassé son budget du jour : 0,62 € comptés pour 0,50 €/);
  });

  it('plafond global dépassé → alerte sans agent', () => {
    const entrees = [entree({ agent: 'beta', cout_eur: 3.2 })];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 1), enCours: vide, config });
    const globale = alertes.find((a) => a.id === 'budget:plafond');
    assert.ok(globale);
    assert.equal(globale.agent, null);
    assert.match(globale.message, /Plafond du jour dépassé : 3,20 €/);
  });

  it('pas d\'alerte tant que tout va bien', () => {
    assert.deepEqual(calculerAlertes({ agents: [agent], entrees: [entree({ cout_eur: 0.1 })], maintenant: date(9, 1), enCours: vide, config }), []);
  });
});

describe('alerte d\'échec', () => {
  const agent = { id: 'alpha', nom: 'Alpha', planning: null, budget_jour_eur: 5 };

  it('nominal : le dernier passage a échoué → alerte avec la raison et l\'heure', () => {
    const entrees = [entree({ statut: 'echec', erreur: 'Nombre maximal de tours atteint (5).', fin: isoLocal(date(8, 15)) })];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 0), enCours: vide, config });
    assert.equal(alertes.length, 1);
    assert.equal(alertes[0].type, 'echec');
    assert.match(alertes[0].message, /^Alpha a échoué à 08:15 : nombre maximal de tours atteint/, 'minuscule après les deux-points');
  });

  it('l\'autre sens : un passage réussi ensuite fait disparaître l\'alerte', () => {
    const entrees = [
      entree({ statut: 'echec', erreur: 'x', debut: isoLocal(date(8, 0)), fin: isoLocal(date(8, 1)) }),
      entree({ statut: 'reussi', debut: isoLocal(date(8, 30)), fin: isoLocal(date(8, 31)) }),
    ];
    assert.deepEqual(calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 0), enCours: vide, config }), []);
  });

  it('un échec d\'hier ne déclenche pas d\'alerte aujourd\'hui', () => {
    const entrees = [entree({ statut: 'echec', erreur: 'x', debut: isoLocal(date(8, 0, 20)), fin: isoLocal(date(8, 1, 20)) })];
    assert.deepEqual(calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 0), enCours: vide, config }), []);
  });
});

describe('cause du retard : on dit pourquoi, plutôt que d\'afficher un retard muet', () => {
  const retard = (surcharges = {}) => calculerAlertes({
    agents: [{ ...veille, ...surcharges.agent }], entrees: [], maintenant: date(14, 0), enCours: vide, config, demarrage: surcharges.demarrage ?? null,
  })[0].message;

  it('cockpit démarré après l\'heure prévue (premier lancement de la journée)', () => {
    assert.equal(retard({ demarrage: date(13, 55) }), 'Veille n\'a pas tourné à 07:30 : le cockpit n\'était pas lancé à cette heure (démarré à 13:55).');
  });

  it('cockpit lancé depuis le matin mais agent.md créé ou modifié après l\'heure prévue', () => {
    assert.equal(retard({ demarrage: date(6, 0), agent: { modifie: date(11, 15) } }),
      'Veille n\'a pas tourné à 07:30 : son agent.md a été créé ou modifié à 11:15, après cette heure.');
  });

  it('cockpit lancé avant l\'heure et agent inchangé : le cockpit n\'a pas pu le lancer (Mac en veille ?)', () => {
    assert.equal(retard({ demarrage: date(6, 0), agent: { modifie: date(5, 0) } }),
      'Veille n\'a pas tourné à 07:30 : le cockpit tournait mais n\'a pas pu le lancer (Mac en veille ?).');
  });

  it('un démarrage dans la tolérance (07:31) n\'est pas une cause : le planificateur a pu lancer l\'agent', () => {
    assert.match(retard({ demarrage: date(7, 31) }), /Mac en veille/);
  });
});

describe('coût inconnu : l\'estimation prudente compte dans le budget', () => {
  const agent = { id: 'alpha', nom: 'Alpha', planning: null, budget_jour_eur: 0.25 };

  it('un passage interrompu sans résultat déclenche l\'alerte de dépassement, avec la part estimée', () => {
    const entrees = [entree({ statut: 'echec', cout_eur: null, cout_usd: null, cout_estime_eur: 0.3, erreur: 'interrompu' })];
    const alertes = calculerAlertes({ agents: [agent], entrees, maintenant: date(9, 0), enCours: vide, config });
    const budget = alertes.find((a) => a.type === 'budget');
    assert.ok(budget);
    assert.match(budget.message, /a dépassé son budget du jour : 0,30 € comptés pour 0,25 € \(dont 0,30 € estimés, coût inconnu\)/);
  });
});

describe('autres alertes et tri', () => {
  it('un agent.md illisible produit une alerte de configuration', () => {
    const alertes = calculerAlertes({
      agents: [], invalides: [{ id: 'casse', erreur: 'la clé « nom » est obligatoire' }], entrees: [], maintenant: date(9, 0), enCours: vide, config,
    });
    assert.equal(alertes[0].type, 'config');
    assert.match(alertes[0].message, /casse.*ignoré.*« nom » est obligatoire/);
  });

  it('l\'erreur « WebFetch » seul arrive telle quelle dans l\'alerte de configuration', () => {
    const erreur = '« WebFetch » seul laisserait l\'agent ouvrir n\'importe quelle page du web : écris « WebFetch(domain:example.org) », un domaine par site de confiance';
    const alertes = calculerAlertes({ agents: [], invalides: [{ id: 'veille', erreur }], entrees: [], maintenant: date(9, 0), enCours: vide, config });
    assert.equal(alertes[0].type, 'config');
    assert.ok(alertes[0].message.includes('WebFetch(domain:example.org)'), alertes[0].message);
  });

  it('les échecs passent avant les budgets, puis les retards', () => {
    const agents = [
      { id: 'a', nom: 'A', planning: '07:30', budget_jour_eur: 0.5 },
      { id: 'b', nom: 'B', planning: null, budget_jour_eur: 0.5 },
      { id: 'c', nom: 'C', planning: null, budget_jour_eur: 5 },
    ];
    const entrees = [
      entree({ agent: 'b', cout_eur: 0.7 }),
      entree({ agent: 'c', statut: 'echec', erreur: 'x', debut: isoLocal(date(8, 0)), fin: isoLocal(date(8, 1)) }),
    ];
    const types = calculerAlertes({ agents, entrees, maintenant: date(10, 0), enCours: vide, config }).map((a) => a.type);
    assert.deepEqual(types, ['echec', 'budget', 'retard']);
  });
});

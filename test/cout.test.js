import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coutBudgetaireDuJour, coutDuJour, coutEstimeDuJour, estimationPassage, passagesInconnus, reservesEnCours, usdVersEur, verifierBudget } from '../src/cout.js';
import { isoLocal, jourLocal } from '../src/utilitaires.js';
import { configTest, date, entree } from './aide.js';

const config = configTest({ taux_usd_eur: 0.86, plafond_jour_eur: 3, estimation_defaut_eur: 0.15 });
const alpha = { id: 'alpha', nom: 'Alpha', budget_jour_eur: 0.5 };
const midi = date(12, 0);

describe('conversion en euros', () => {
  it('applique le taux de la configuration', () => {
    assert.equal(usdVersEur(1, 0.86), 0.86);
    assert.equal(usdVersEur(0.1234, 0.86), 0.106124);
    assert.equal(usdVersEur(0, 0.86), 0);
  });

  it('ne laisse pas de bruit de virgule flottante', () => {
    assert.equal(usdVersEur(0.3, 0.1), 0.03);
  });
});

describe('coutDuJour', () => {
  const entrees = [
    entree({ agent: 'alpha', cout_eur: 0.1 }),
    entree({ agent: 'alpha', cout_eur: 0.2, debut: isoLocal(date(9, 0)) }),
    entree({ agent: 'beta', cout_eur: 0.4, debut: isoLocal(date(10, 0)) }),
    entree({ agent: 'alpha', cout_eur: 5, debut: isoLocal(date(9, 0, 20)) }), // la veille
    entree({ agent: 'alpha', cout_eur: null, statut: 'echec', debut: isoLocal(date(11, 0)) }), // coût inconnu
  ];

  it('additionne par agent et au total, pour un seul jour', () => {
    assert.equal(coutDuJour(entrees, '2026-10-21', 'alpha'), 0.3);
    assert.equal(coutDuJour(entrees, '2026-10-21'), 0.7);
    assert.equal(coutDuJour(entrees, '2026-10-20'), 5);
  });

  it('un coût inconnu compte pour zéro, sans casser la somme', () => {
    assert.equal(coutDuJour([entree({ cout_eur: null })], '2026-10-21'), 0);
  });

  it('respecte la frontière de minuit (heure locale)', () => {
    const avantMinuit = entree({ cout_eur: 1, debut: isoLocal(new Date(2026, 9, 21, 23, 59, 59)) });
    const apresMinuit = entree({ cout_eur: 2, debut: isoLocal(new Date(2026, 9, 22, 0, 0, 1)) });
    assert.equal(coutDuJour([avantMinuit, apresMinuit], '2026-10-21'), 1);
    assert.equal(coutDuJour([avantMinuit, apresMinuit], '2026-10-22'), 2);
    assert.equal(jourLocal(date(0, 0)), '2026-10-21');
  });
});

describe('estimationPassage', () => {
  it('sans historique : la valeur de la configuration', () => {
    assert.equal(estimationPassage([], 'alpha', config), 0.15);
  });

  it('avec historique : le plus cher des 5 derniers passages (estimation prudente)', () => {
    const couts = [0.9, 0.05, 0.1, 0.2, 0.06, 0.07];
    const entrees = couts.map((c, i) => entree({ cout_eur: c, debut: isoLocal(date(8, i)) }));
    // les 5 derniers sont 0.05, 0.1, 0.2, 0.06, 0.07 : le 0.9 est trop ancien
    assert.equal(estimationPassage(entrees, 'alpha', config), 0.2);
  });

  it('ignore les refus, les coûts inconnus et les autres agents', () => {
    const entrees = [
      entree({ statut: 'bloque_budget', cout_eur: 0 }),
      entree({ cout_eur: null, statut: 'echec' }),
      entree({ agent: 'beta', cout_eur: 9 }),
    ];
    assert.equal(estimationPassage(entrees, 'alpha', config), 0.15);
  });
});

describe('verifierBudget', () => {
  it('accepte un lancement sans historique', () => {
    const v = verifierBudget({ entrees: [], agent: alpha, config, maintenant: midi });
    assert.equal(v.ok, true);
    assert.equal(v.estimation_eur, 0.15);
  });

  it('refuse si le budget de l\'agent serait dépassé, et dit pourquoi', () => {
    const entrees = [entree({ cout_eur: 0.4 })]; // estimation prudente = 0.4 → 0.4 + 0.4 > 0.5
    const v = verifierBudget({ entrees, agent: alpha, config, maintenant: midi });
    assert.equal(v.ok, false);
    assert.equal(v.raison, 'budget_agent');
    assert.equal(v.message, 'Alpha non lancé : il dépasserait son budget du jour (0,50 €). Déjà compté : 0,40 €, estimation de ce passage : 0,40 €.');
    assert.equal(v.detail, 'il dépasserait son budget du jour (0,50 €)', 'commence par une minuscule : se place derrière un deux-points');
    assert.match(v.conseil, /^Relève le budget de « Alpha » dans son agent\.md pour le lancer/, 'commence par un verbe');
  });

  it('refuse si le plafond du jour serait dépassé, même si l\'agent a encore du budget', () => {
    const entrees = [entree({ agent: 'beta', cout_eur: 2.9, debut: isoLocal(date(9, 0)) })];
    const v = verifierBudget({ entrees, agent: alpha, config, maintenant: midi });
    assert.equal(v.ok, false);
    assert.equal(v.raison, 'plafond_jour');
    assert.match(v.message, /^Alpha non lancé : il dépasserait le plafond du jour \(3,00 €\)/);
    assert.match(v.conseil, /^Relève le plafond du jour dans config\.json/);
  });

  it('cas limite : tomber exactement sur le plafond est accepté, un centime de plus est refusé', () => {
    const exact = [entree({ agent: 'beta', cout_eur: 2.85, debut: isoLocal(date(9, 0)) })]; // 2.85 + 0.15 = 3.00
    assert.equal(verifierBudget({ entrees: exact, agent: alpha, config, maintenant: midi }).ok, true);
    const depasse = [entree({ agent: 'beta', cout_eur: 2.86, debut: isoLocal(date(9, 0)) })];
    assert.equal(verifierBudget({ entrees: depasse, agent: alpha, config, maintenant: midi }).ok, false);
  });

  it('cas limite : 0,1 dépensé + 0,2 d\'estimation pour un budget de 0,3 est accepté (pas d\'erreur de virgule flottante)', () => {
    const agent = { ...alpha, budget_jour_eur: 0.3 };
    const entrees = [
      entree({ cout_eur: 0.2, debut: isoLocal(date(8, 0, 20)) }), // hier : fixe l'estimation prudente à 0,2
      entree({ cout_eur: 0.1, debut: isoLocal(date(8, 0)) }), //     aujourd'hui : 0,1 déjà dépensé
    ];
    assert.equal(0.1 + 0.2 > 0.3, true, 'en flottants bruts, 0,1 + 0,2 dépasserait 0,3');
    assert.equal(verifierBudget({ entrees, agent, config, maintenant: midi }).ok, true);
  });

  it('compte les passages déjà en cours comme de l\'argent engagé', () => {
    const entrees = [entree({ agent: 'beta', cout_eur: 2.5, debut: isoLocal(date(9, 0)) })];
    const enCours = new Map([['gamma', { estimation_eur: 0.5 }]]);
    const sans = verifierBudget({ entrees, agent: alpha, config, maintenant: midi });
    assert.equal(sans.ok, true); // 2,5 + 0,15 <= 3
    const avec = verifierBudget({ entrees, agent: alpha, config, maintenant: midi, reserves: reservesEnCours(enCours) });
    assert.equal(avec.ok, false); // 2,5 + 0,5 engagés + 0,15 > 3
    assert.equal(avec.raison, 'plafond_jour');
    assert.equal(reservesEnCours(new Map([['alpha', { estimation_eur: 1 }]]), 'alpha'), 0, 'l\'agent lui-même n\'est pas compté deux fois');
  });

  it('ne tient pas compte des dépenses de la veille', () => {
    const entrees = [entree({ cout_eur: 0.49, debut: isoLocal(date(23, 0, 20)) })];
    assert.equal(verifierBudget({ entrees, agent: alpha, config, maintenant: midi }).ok, true);
  });
});

describe('coût inconnu (Claude Code n\'a pas renvoyé son résultat)', () => {
  const inconnu = (surcharges = {}) => entree({ statut: 'echec', cout_usd: null, cout_eur: null, cout_estime_eur: 0.4, ...surcharges });

  it('le coût réel ne le compte pas, le budget compte son estimation', () => {
    const entrees = [entree({ cout_eur: 0.1 }), inconnu({ debut: isoLocal(date(9, 0)) })];
    assert.equal(coutDuJour(entrees, '2026-10-21'), 0.1, 'le coût affiché reste le coût réel');
    assert.equal(coutEstimeDuJour(entrees, '2026-10-21'), 0.4);
    assert.equal(coutBudgetaireDuJour(entrees, '2026-10-21'), 0.5);
    assert.equal(passagesInconnus(entrees, '2026-10-21'), 1);
  });

  it('une ancienne ligne sans estimation utilise la valeur de repli', () => {
    const ancienne = inconnu();
    delete ancienne.cout_estime_eur;
    assert.equal(coutEstimeDuJour([ancienne], '2026-10-21', null, 0.15), 0.15);
  });

  it('un refus de budget n\'est pas un coût inconnu', () => {
    const refus = entree({ statut: 'bloque_budget', cout_eur: null, cout_estime_eur: null });
    assert.equal(passagesInconnus([refus], '2026-10-21'), 0);
    assert.equal(coutEstimeDuJour([refus], '2026-10-21', null, 0.15), 0);
  });

  it('le budget refuse un lancement que seule l\'estimation du passage interrompu fait dépasser', () => {
    const entrees = [inconnu({ debut: isoLocal(date(8, 0)) })]; // 0,40 € estimés ; estimation par défaut 0,15 € : 0,55 € > 0,50 €
    const v = verifierBudget({ entrees, agent: alpha, config, maintenant: midi });
    assert.equal(v.ok, false);
    assert.equal(v.cout_agent_eur, 0.4);
    assert.match(v.message, /Déjà compté : 0,40 €/);
  });
});

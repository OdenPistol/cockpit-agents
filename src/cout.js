// Coût et budgets.
//
// Principe d'honnêteté : on ne recalcule jamais le coût à partir des jetons. On prend le
// `total_cost_usd` que Claude Code renvoie dans l'événement final « result », et on le
// convertit en euros avec le taux écrit dans config.json (`taux_usd_eur`).
// Ce chiffre est une estimation de Claude Code, pas une facture.
//
// Si Claude Code s'arrête sans renvoyer son « result » (coupure, délai dépassé), le coût est
// inconnu : le journal garde `cout_eur: null` et l'écran dit « coût inconnu ». Pour que le budget
// ne soit pas contourné par une coupure, ce passage compte à hauteur de l'estimation prudente du
// moment (champ `cout_estime_eur`). Cette estimation n'est jamais affichée comme un coût réel.

import { jourLocal, arrondir, microEuros, eur } from './utilitaires.js';

/** Convertit des dollars en euros avec le taux de la configuration. */
export function usdVersEur(usd, taux) {
  return arrondir(usd * taux, 6);
}

function duJour(e, jour, agentId) {
  return (agentId === null || e.agent === agentId) && jourLocal(new Date(e.debut)) === jour;
}

/** Coût réel (en euros) des passages d'un jour, pour un agent ou pour tous. Les coûts inconnus ne comptent pas ici. */
export function coutDuJour(entrees, jour, agentId = null) {
  let total = 0;
  for (const e of entrees) {
    if (duJour(e, jour, agentId) && typeof e.cout_eur === 'number') total += e.cout_eur;
  }
  return arrondir(total, 6);
}

/** Estimations comptées pour les passages au coût inconnu (`repli` si une ancienne ligne n'en porte pas). */
export function coutEstimeDuJour(entrees, jour, agentId = null, repli = 0) {
  let total = 0;
  for (const e of entrees) {
    if (duJour(e, jour, agentId) && e.cout_eur === null && e.statut !== 'bloque_budget') {
      total += typeof e.cout_estime_eur === 'number' ? e.cout_estime_eur : repli;
    }
  }
  return arrondir(total, 6);
}

/** Nombre de passages d'un jour dont le coût est inconnu. */
export function passagesInconnus(entrees, jour, agentId = null) {
  return entrees.filter((e) => duJour(e, jour, agentId) && e.cout_eur === null && e.statut !== 'bloque_budget').length;
}

/** Ce que le budget doit compter : le coût réel plus les estimations des passages au coût inconnu. */
export function coutBudgetaireDuJour(entrees, jour, agentId = null, repli = 0) {
  return arrondir(coutDuJour(entrees, jour, agentId) + coutEstimeDuJour(entrees, jour, agentId, repli), 6);
}

/**
 * Estimation prudente du coût d'un prochain passage : le plus cher des `nbRecents`
 * derniers passages de cet agent. Sans historique, la valeur de config.json.
 */
export function estimationPassage(entrees, agentId, config, nbRecents = 5) {
  const couts = entrees
    .filter((e) => e.agent === agentId
      && (e.statut === 'reussi' || e.statut === 'echec')
      && typeof e.cout_eur === 'number' && e.cout_eur > 0)
    .sort((a, b) => new Date(a.debut) - new Date(b.debut))
    .slice(-nbRecents)
    .map((e) => e.cout_eur);
  return couts.length > 0 ? Math.max(...couts) : config.estimation_defaut_eur;
}

/** Somme des estimations des passages en cours (hors `sauf`) : de l'argent déjà « engagé ». */
export function reservesEnCours(enCours, sauf = null) {
  let total = 0;
  for (const [id, passage] of enCours) {
    if (id !== sauf) total += passage.estimation_eur ?? 0;
  }
  return total;
}

/**
 * Peut-on lancer cet agent maintenant ?
 * Refus si (coût du jour de l'agent + estimation) dépasse son budget, ou si
 * (coût du jour total + passages en cours + estimation) dépasse le plafond du jour.
 * Les « coûts du jour » comptent les estimations des passages au coût inconnu.
 * Un coût qui tombe exactement sur le plafond est accepté : seul un dépassement est refusé.
 *
 * Quand c'est refusé, le résultat porte :
 *   detail   la raison, en une proposition qui commence par une minuscule (« il dépasserait son budget… »)
 *   chiffres les montants, en une phrase
 *   message  la phrase complète pour l'alerte et le journal
 *   conseil  la phrase de l'infobulle, qui commence par un verbe
 */
export function verifierBudget({ entrees, agent, config, maintenant, reserves = 0 }) {
  const jour = jourLocal(maintenant);
  const repli = config.estimation_defaut_eur;
  const estimation = estimationPassage(entrees, agent.id, config);
  const coutAgent = coutBudgetaireDuJour(entrees, jour, agent.id, repli);
  const coutTotal = coutBudgetaireDuJour(entrees, jour, null, repli);
  const base = { estimation_eur: estimation, cout_agent_eur: coutAgent, cout_total_eur: coutTotal };

  if (microEuros(coutAgent + estimation) > microEuros(agent.budget_jour_eur)) {
    const detail = `il dépasserait son budget du jour (${eur(agent.budget_jour_eur)})`;
    const chiffres = `Déjà compté : ${eur(coutAgent)}, estimation de ce passage : ${eur(estimation)}.`;
    return {
      ok: false,
      raison: 'budget_agent',
      ...base,
      detail,
      chiffres,
      message: `${agent.nom} non lancé : ${detail}. ${chiffres}`,
      conseil: `Relève le budget de « ${agent.nom} » dans son agent.md pour le lancer : ${detail}.`,
    };
  }
  if (microEuros(coutTotal + reserves + estimation) > microEuros(config.plafond_jour_eur)) {
    const detail = `il dépasserait le plafond du jour (${eur(config.plafond_jour_eur)})`;
    const chiffres = `Déjà compté ou engagé : ${eur(coutTotal + reserves)}, estimation de ce passage : ${eur(estimation)}.`;
    return {
      ok: false,
      raison: 'plafond_jour',
      ...base,
      detail,
      chiffres,
      message: `${agent.nom} non lancé : ${detail}. ${chiffres}`,
      conseil: `Relève le plafond du jour dans config.json, ou attends demain, pour lancer « ${agent.nom} » : ${detail}.`,
    };
  }
  return { ok: true, ...base };
}

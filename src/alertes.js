// Planning et alertes.
//
// Les alertes ne sont pas stockées : elles se déduisent à chaque instant du journal du jour,
// des agents en cours et de l'heure. Une alerte disparaît donc d'elle-même quand le problème
// est réglé (un passage réussi après un échec, un budget relevé, un agent enfin passé).

import { jourLocal, heureLocale, aujourdhuiA, isoLocal, eur, court, microEuros, minusculeInitiale } from './utilitaires.js';
import { coutBudgetaireDuJour, coutEstimeDuJour, verifierBudget, reservesEnCours } from './cout.js';

const ORDRE_TYPES = ['echec', 'budget', 'retard', 'config'];

/** Un passage « couvre » l'heure prévue s'il a commencé après elle, ou s'il s'est terminé après elle. */
function couvre(entree, prevue) {
  if (new Date(entree.debut) >= prevue) return true;
  return entree.fin ? new Date(entree.fin) >= prevue : false;
}

/**
 * Où en est le planning d'un agent aujourd'hui ?
 *   sans_planning    pas d'heure prévue
 *   a_venir          l'heure prévue n'est pas arrivée
 *   dans_la_fenetre  l'heure est arrivée depuis moins de `tolerance_min` minutes : le planificateur lance l'agent
 *   en_cours         l'agent tourne
 *   fait             l'agent est passé à partir de l'heure prévue (réussi, échoué ou refusé par le budget)
 *   en_retard        l'heure prévue + la tolérance est passée et l'agent n'a pas tourné
 */
export function statutPlanning({ agent, entrees, maintenant, enCours, tolerance_min }) {
  if (!agent.planning) return { etat: 'sans_planning', prevue: null };
  const prevue = aujourdhuiA(maintenant, agent.planning);
  if (maintenant < prevue) return { etat: 'a_venir', prevue };
  if (enCours.has(agent.id)) return { etat: 'en_cours', prevue };
  if (entrees.some((e) => e.agent === agent.id && couvre(e, prevue))) return { etat: 'fait', prevue };
  const limite = new Date(prevue.getTime() + tolerance_min * 60000);
  if (maintenant < limite) return { etat: 'dans_la_fenetre', prevue };
  return { etat: 'en_retard', prevue };
}

/** Prochain passage prévu : aujourd'hui tant que l'heure n'est pas passée ou que l'agent n'est pas parti, sinon demain. */
export function prochainPassage({ agent, entrees, maintenant, enCours, tolerance_min }) {
  if (!agent.planning) return null;
  const { etat, prevue } = statutPlanning({ agent, entrees, maintenant, enCours, tolerance_min });
  if (etat === 'a_venir' || etat === 'dans_la_fenetre') return { quand: prevue, jour: 'aujourdhui' };
  const [h, m] = agent.planning.split(':').map(Number);
  return { quand: new Date(prevue.getFullYear(), prevue.getMonth(), prevue.getDate() + 1, h, m, 0, 0), jour: 'demain' };
}

/**
 * Pourquoi un agent planifié n'a-t-il pas tourné à son heure ? On le dit, plutôt que d'afficher un retard muet.
 *   - le cockpit a démarré après l'heure prévue (le cas du premier lancement de la journée) ;
 *   - ou agent.md a été créé ou modifié après l'heure prévue ;
 *   - sinon le cockpit tournait mais n'a pas pu lancer l'agent (Mac en veille, par exemple).
 */
export function causeDuRetard({ agent, prevue, demarrage, tolerance_min }) {
  if (demarrage && demarrage.getTime() > prevue.getTime() + tolerance_min * 60000) {
    return `le cockpit n'était pas lancé à cette heure (démarré à ${heureLocale(demarrage)})`;
  }
  if (agent.modifie && agent.modifie.getTime() > prevue.getTime()) {
    return `son agent.md a été créé ou modifié à ${heureLocale(agent.modifie)}, après cette heure`;
  }
  return 'le cockpit tournait mais n\'a pas pu le lancer (Mac en veille ?)';
}

function dernierDuJour(entrees, jour, agentId) {
  return entrees
    .filter((e) => e.agent === agentId && jourLocal(new Date(e.debut)) === jour)
    .sort((a, b) => new Date(a.debut) - new Date(b.debut))
    .at(-1);
}

/**
 * Toutes les alertes à afficher maintenant.
 * @param {object} p
 * @param {object[]} p.agents agents valides
 * @param {{id:string, erreur:string}[]} p.invalides agent.md illisibles
 * @param {object[]} p.entrees lignes du journal (au moins celles d'aujourd'hui)
 * @param {Date} p.maintenant
 * @param {Map} p.enCours passages en cours (id → {estimation_eur, …})
 * @param {object} p.config
 * @param {Date|null} [p.demarrage] heure de démarrage du cockpit (pour dire la cause d'un retard)
 * @returns {{id:string, type:'echec'|'budget'|'retard'|'config', agent:string|null, agent_nom:string|null, message:string, depuis:string}[]}
 */
export function calculerAlertes({ agents, invalides = [], entrees, maintenant, enCours, config, demarrage = null }) {
  const alertes = [];
  const jour = jourLocal(maintenant);
  const repli = config.estimation_defaut_eur;

  for (const agent of agents) {
    const derniere = dernierDuJour(entrees, jour, agent.id);
    let alerteBudgetAgent = false;

    if (derniere && !enCours.has(agent.id)) {
      if (derniere.statut === 'echec') {
        alertes.push({
          id: `echec:${agent.id}`,
          type: 'echec',
          agent: agent.id,
          agent_nom: agent.nom,
          message: `${agent.nom} a échoué à ${heureLocale(new Date(derniere.fin ?? derniere.debut))} : ${minusculeInitiale(court(derniere.erreur ?? 'raison inconnue', 220))}`,
          depuis: derniere.fin ?? derniere.debut,
        });
      }
      if (derniere.statut === 'bloque_budget') {
        const verdict = verifierBudget({
          entrees, agent, config, maintenant, reserves: reservesEnCours(enCours, agent.id),
        });
        if (!verdict.ok) {
          alerteBudgetAgent = true;
          alertes.push({
            id: `budget:${agent.id}`,
            type: 'budget',
            agent: agent.id,
            agent_nom: agent.nom,
            message: `${agent.nom} non lancé à ${heureLocale(new Date(derniere.debut))} : ${verdict.detail}. ${verdict.chiffres}`,
            depuis: derniere.debut,
          });
        }
      }
    }

    // Dépassement constaté après coup (un passage en cours n'est jamais coupé).
    const coutAgent = coutBudgetaireDuJour(entrees, jour, agent.id, repli);
    if (!alerteBudgetAgent && microEuros(coutAgent) > microEuros(agent.budget_jour_eur)) {
      const estime = coutEstimeDuJour(entrees, jour, agent.id, repli);
      alertes.push({
        id: `budget:${agent.id}`,
        type: 'budget',
        agent: agent.id,
        agent_nom: agent.nom,
        message: `${agent.nom} a dépassé son budget du jour : ${eur(coutAgent)} comptés pour ${eur(agent.budget_jour_eur)}${estime > 0 ? ` (dont ${eur(estime)} estimés, coût inconnu)` : ''}. Les prochains lancements seront refusés.`,
        depuis: isoLocal(maintenant),
      });
    }

    const planning = statutPlanning({ agent, entrees, maintenant, enCours, tolerance_min: config.tolerance_retard_min });
    if (planning.etat === 'en_retard') {
      alertes.push({
        id: `retard:${agent.id}`,
        type: 'retard',
        agent: agent.id,
        agent_nom: agent.nom,
        message: `${agent.nom} n'a pas tourné à ${agent.planning} : ${causeDuRetard({ agent, prevue: planning.prevue, demarrage, tolerance_min: config.tolerance_retard_min })}.`,
        depuis: isoLocal(planning.prevue),
      });
    }
  }

  const coutTotal = coutBudgetaireDuJour(entrees, jour, null, repli);
  if (microEuros(coutTotal) > microEuros(config.plafond_jour_eur)) {
    const estime = coutEstimeDuJour(entrees, jour, null, repli);
    alertes.push({
      id: 'budget:plafond',
      type: 'budget',
      agent: null,
      agent_nom: null,
      message: `Plafond du jour dépassé : ${eur(coutTotal)} comptés pour un plafond de ${eur(config.plafond_jour_eur)}${estime > 0 ? ` (dont ${eur(estime)} estimés, coût inconnu)` : ''}. Plus aucun agent ne sera lancé aujourd'hui.`,
      depuis: isoLocal(maintenant),
    });
  }

  for (const invalide of invalides) {
    alertes.push({
      id: `config:${invalide.id}`,
      type: 'config',
      agent: invalide.id,
      agent_nom: invalide.id,
      message: `Le dossier « ${invalide.id} » est ignoré : ${invalide.erreur}.`,
      depuis: isoLocal(maintenant),
    });
  }

  return alertes.sort((a, b) =>
    ORDRE_TYPES.indexOf(a.type) - ORDRE_TYPES.indexOf(b.type) || String(b.depuis).localeCompare(String(a.depuis)));
}

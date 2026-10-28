// L'état affiché à l'écran, calculé à la demande à partir du journal, des agents et de l'heure.
// Rien n'est stocké en dehors du journal : c'est la seule source des chiffres.

import { calculerAlertes, prochainPassage, statutPlanning } from './alertes.js';
import { coutDuJour, coutEstimeDuJour, passagesInconnus, reservesEnCours, verifierBudget } from './cout.js';
import { arrondir, isoLocal, jourLocal } from './utilitaires.js';

const parDebut = (a, b) => new Date(a.debut) - new Date(b.debut);

/** Vrai si l'utilisateur est sur un abonnement : le coût affiché est alors un « équivalent API ». */
export function estAbonnement(config, claude) {
  if (config.abonnement === 'oui') return true;
  if (config.abonnement === 'non') return false;
  if (!claude || !claude.auth) return null;
  return claude.auth === 'claude.ai' || claude.auth === 'oauth_token';
}

/**
 * @param {object} p
 * @param {object[]} p.agents agents valides
 * @param {{id:string, erreur:string}[]} p.invalides agent.md illisibles
 * @param {object[]} p.entrees lignes du journal (14 derniers jours)
 * @param {Map} p.enCours passages en cours
 * @param {Date} p.maintenant
 * @param {object} p.config
 * @param {object|null} p.claude résultat de detecterClaude
 * @param {Date|null} [p.demarrage] heure de démarrage du cockpit
 */
export function construireEtat({ agents, invalides, entrees, enCours, maintenant, config, claude, demarrage = null }) {
  const jour = jourLocal(maintenant);
  const repli = config.estimation_defaut_eur;
  const coutJour = coutDuJour(entrees, jour);
  const estime = coutEstimeDuJour(entrees, jour, null, repli);
  const plafond = config.plafond_jour_eur;

  const alertes = calculerAlertes({ agents, invalides, entrees, maintenant, enCours, config, demarrage });
  if (claude && !claude.ok) {
    alertes.unshift({ id: 'config:claude', type: 'config', agent: null, agent_nom: null, message: claude.erreur, depuis: isoLocal(maintenant) });
  } else if (claude && claude.connecte === false) {
    alertes.unshift({
      id: 'config:connexion',
      type: 'config',
      agent: null,
      agent_nom: null,
      message: 'Claude Code n\'est pas connecté à un compte. Ouvre un terminal, tape « claude auth login », puis relance le cockpit.',
      depuis: isoLocal(maintenant),
    });
  }

  const cartes = agents.map((agent) => {
    const duJour = entrees.filter((e) => e.agent === agent.id && jourLocal(new Date(e.debut)) === jour).sort(parDebut);
    const passages = entrees.filter((e) => e.agent === agent.id && e.statut !== 'bloque_budget').sort(parDebut);
    const dernier = passages.at(-1) ?? null;
    const enMarche = enCours.get(agent.id) ?? null;

    let statut;
    if (enMarche) {
      statut = 'en_cours';
    } else {
      const derniereTentative = duJour.at(-1);
      const bloque = derniereTentative?.statut === 'bloque_budget'
        && !verifierBudget({ entrees, agent, config, maintenant, reserves: reservesEnCours(enCours, agent.id) }).ok;
      const dernierReel = duJour.filter((e) => e.statut !== 'bloque_budget').at(-1);
      statut = bloque ? 'bloque_budget' : (dernierReel?.statut ?? 'pret');
    }

    // ce qu'il a fait aujourd'hui, en une ligne écrite par lui (journal, champ « bilan ») : seulement si son dernier
    // vrai passage du jour a réussi ; sinon l'écran garde sa description
    const dernierDuJour = duJour.filter((e) => e.statut !== 'bloque_budget').at(-1);
    const fait = dernierDuJour?.statut === 'reussi' && typeof dernierDuJour.bilan === 'string' && dernierDuJour.bilan.trim() !== ''
      ? dernierDuJour.bilan.trim()
      : null;

    const planning = statutPlanning({ agent, entrees, maintenant, enCours, tolerance_min: config.tolerance_retard_min });
    const prochain = prochainPassage({ agent, entrees, maintenant, enCours, tolerance_min: config.tolerance_retard_min });

    return {
      id: agent.id,
      nom: agent.nom,
      description: agent.description,
      fait,
      invalide: false,
      statut,
      planning: agent.planning,
      dernier_passage: dernier ? (dernier.fin ?? dernier.debut) : null,
      dernier_statut: dernier ? dernier.statut : null,
      dernier_duree_ms: dernier ? (dernier.duree_ms ?? null) : null,
      // pour la fiche de l'agent : son dernier passage tel que le journal l'a écrit (début, coût, fichier produit)
      dernier_debut: dernier ? dernier.debut : null,
      dernier_cout_eur: dernier && typeof dernier.cout_eur === 'number' ? dernier.cout_eur : null,
      dernier_resultat: dernier ? (dernier.resultat ?? null) : null,
      prochain_passage: prochain ? isoLocal(prochain.quand) : null,
      prochain_jour: prochain ? prochain.jour : null,
      en_retard: planning.etat === 'en_retard',
      cout_jour_eur: coutDuJour(entrees, jour, agent.id),
      cout_estime_eur: coutEstimeDuJour(entrees, jour, agent.id, repli),
      budget_jour_eur: agent.budget_jour_eur,
      en_cours_depuis: enMarche ? enMarche.debut : null,
      outils: agent.outils,
      max_tours: agent.max_tours,
    };
  });

  for (const invalide of invalides) {
    cartes.push({
      id: invalide.id,
      nom: invalide.id,
      description: invalide.erreur,
      fait: null,
      invalide: true,
      statut: 'invalide',
      planning: null,
      dernier_passage: null,
      dernier_statut: null,
      dernier_duree_ms: null,
      dernier_debut: null,
      dernier_cout_eur: null,
      dernier_resultat: null,
      prochain_passage: null,
      prochain_jour: null,
      en_retard: false,
      cout_jour_eur: 0,
      cout_estime_eur: 0,
      budget_jour_eur: 0,
      en_cours_depuis: null,
      outils: [],
      max_tours: 0,
    });
  }

  const historique = [...entrees]
    .sort(parDebut)
    .reverse()
    .slice(0, 12)
    .map((e) => ({
      agent: e.agent,
      agent_nom: e.agent_nom ?? e.agent,
      debut: e.debut,
      duree_ms: e.duree_ms ?? null,
      cout_eur: typeof e.cout_eur === 'number' ? e.cout_eur : null,
      statut: e.statut,
      tours: e.tours ?? null,
      resultat: e.resultat ?? null,
      declencheur: e.declencheur ?? null,
      erreur: e.erreur ?? null,
    }));

  // le dernier passage terminé, avec ses étapes : le journal de l'écran le remontre, atténué, quand rien ne tourne
  const finDe = (e) => new Date(e.fin ?? e.debut);
  const termine = entrees
    .filter((e) => e.statut !== 'bloque_budget' && Array.isArray(e.etapes) && e.etapes.length > 0)
    .reduce((plusRecent, e) => (plusRecent === null || finDe(e) >= finDe(plusRecent) ? e : plusRecent), null);
  const dernierPassage = termine === null ? null : {
    agent: termine.agent,
    agent_nom: termine.agent_nom ?? termine.agent,
    debut: termine.debut,
    fin: termine.fin ?? null,
    statut: termine.statut,
    etapes: termine.etapes
      .filter((l) => l && typeof l.texte === 'string' && typeof l.ts === 'string')
      .map((l) => ({ ts: l.ts, niveau: l.niveau ?? 'info', ...(l.type ? { type: l.type } : {}), texte: l.texte })),
  };

  return {
    maintenant: isoLocal(maintenant).slice(0, 16),
    jour,
    cout: {
      jour_eur: coutJour,
      estime_eur: estime,
      passages_inconnus: passagesInconnus(entrees, jour),
      // les passages réussis du jour : l'écran les compte sous le coût du jour (ce que la somme a payé)
      taches_jour: entrees.filter((e) => e.statut === 'reussi' && jourLocal(new Date(e.debut)) === jour).length,
      plafond_eur: plafond,
      reste_eur: arrondir(plafond - coutJour - estime, 6),
      depasse: coutJour + estime > plafond,
      equivalent_api: estAbonnement(config, claude),
      taux_usd_eur: config.taux_usd_eur,
    },
    claude: claude ? { ok: claude.ok, version: claude.version, connecte: claude.connecte } : null,
    reglages: {
      modele: config.modele || 'modèle par défaut du compte',
      configuration_isolee: config.configuration_isolee,
    },
    agents: cartes,
    alertes,
    historique,
    dernier_passage: dernierPassage,
  };
}

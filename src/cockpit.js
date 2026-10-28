// Le chef d'orchestre : garde en mémoire les passages en cours et le journal en direct,
// vérifie les budgets avant chaque lancement, déclenche les agents planifiés.
// Il n'a aucune dépendance à HTTP : le serveur web, le script d'essai et les tests l'utilisent tel quel.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { chargerAgents } from './agent-md.js';
import { statutPlanning } from './alertes.js';
import { reservesEnCours, verifierBudget } from './cout.js';
import { construireEtat } from './etat.js';
import { ajouterEntree, lireRecents } from './journal.js';
import { executer } from './lanceur.js';
import { court, isoLocal } from './utilitaires.js';

const TAILLE_JOURNAL_EN_DIRECT = 300;

function lancerCommande(commande, args, delaiMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(commande, args, { timeout: delaiMs, env: process.env, maxBuffer: 1 << 20 }, (erreur, stdout, stderr) => {
      if (erreur) {
        erreur.stdout = stdout;
        reject(erreur);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Vérifie que Claude Code est installé et connecté.
 * De `claude auth status`, on ne retient que le mode de connexion (« authMethod ») et si on est connecté :
 * l'adresse e-mail et l'organisation que la commande affiche ne sont ni lues, ni stockées.
 */
export async function detecterClaude(config) {
  const info = { ok: false, version: null, connecte: null, auth: null, erreur: null };
  try {
    const { stdout } = await lancerCommande(config.commande_claude, ['--version']);
    info.version = stdout.trim().split(/\s+/)[0] || null;
    info.ok = true;
  } catch (e) {
    info.erreur = e.code === 'ENOENT'
      ? `Claude Code est introuvable (commande « ${config.commande_claude} »). Installe-le (voir docs/README-complet.md), puis relance le cockpit.`
      : `Claude Code ne répond pas : ${court(e.message, 160)}`;
    return info;
  }
  const lireStatut = (texte) => {
    const j = JSON.parse(texte);
    info.connecte = j.loggedIn === true;
    info.auth = typeof j.authMethod === 'string' ? j.authMethod : null;
  };
  try {
    lireStatut((await lancerCommande(config.commande_claude, ['auth', 'status'])).stdout);
  } catch (e) {
    try {
      lireStatut(e.stdout ?? ''); // `auth status` sort en erreur quand on n'est pas connecté, mais écrit quand même son JSON
    } catch {
      // statut illisible : on ne dit rien plutôt que de se tromper
    }
  }
  return info;
}

export class Cockpit extends EventEmitter {
  /**
   * @param {object} p
   * @param {string} p.racine dossier du projet
   * @param {object} p.config configuration validée
   * @param {() => Date} [p.maintenant] horloge (remplaçable dans les tests)
   */
  constructor({ racine, config, maintenant = () => new Date() }) {
    super();
    this.racine = racine;
    this.config = config;
    this.maintenant = maintenant;
    this.dossierJournal = path.join(racine, 'journal');
    this.enCours = new Map(); // id d'agent → { debut, estimation_eur, arreter, promesse }
    this.lignes = [];
    this.claude = null;
    this.minuteurPlanification = null;
    this.demarrage = maintenant(); // sert à dire la cause d'un retard : « le cockpit n'était pas lancé à cette heure »
  }

  async initialiser() {
    this.claude = await detecterClaude(this.config);
    return this.claude;
  }

  agents() {
    return chargerAgents(this.racine, this.config.ordre);
  }

  entrees() {
    return lireRecents(this.dossierJournal, this.maintenant(), 14);
  }

  etat() {
    const { agents, invalides } = this.agents();
    return construireEtat({
      agents,
      invalides,
      entrees: this.entrees(),
      enCours: this.enCours,
      maintenant: this.maintenant(),
      config: this.config,
      claude: this.claude,
      demarrage: this.demarrage,
    });
  }

  /** Ajoute une ligne au journal en direct et la diffuse. */
  ligne(agent, l) {
    const complete = { agent: agent.id, agent_nom: agent.nom, ...l };
    this.lignes.push(complete);
    if (this.lignes.length > TAILLE_JOURNAL_EN_DIRECT) this.lignes.shift();
    this.emit('ligne', complete);
  }

  /**
   * Lance un agent, après vérification du budget.
   * @returns {{ok:true, promesse:Promise<object>} | {ok:false, code:string, message:string, conseil:string, entree?:object}}
   *   `message` dit ce qui s'est passé ; `conseil` (qui commence par un verbe) dit quoi faire : c'est le texte de l'infobulle.
   */
  lancer(id, declencheur = 'manuel') {
    const { agents, invalides } = this.agents();
    const invalide = invalides.find((i) => i.id === id);
    if (invalide) {
      return {
        ok: false,
        code: 'agent_invalide',
        message: `L'agent « ${id} » est illisible : ${invalide.erreur}.`,
        conseil: `Corrige le fichier agents/${id}/agent.md : ${invalide.erreur}.`,
      };
    }
    const agent = agents.find((a) => a.id === id);
    if (!agent) {
      return {
        ok: false,
        code: 'inconnu',
        message: `Aucun agent « ${id} » dans le dossier agents/.`,
        conseil: `Vérifie que le dossier agents/${id}/ existe, puis recharge la page.`,
      };
    }
    if (this.enCours.has(id)) {
      return {
        ok: false,
        code: 'deja_en_cours',
        message: `« ${agent.nom} » est déjà en cours.`,
        conseil: `Attends la fin du passage en cours de « ${agent.nom} ».`,
      };
    }

    const maintenant = this.maintenant();
    const verdict = verifierBudget({
      entrees: this.entrees(),
      agent,
      config: this.config,
      maintenant,
      reserves: reservesEnCours(this.enCours),
    });

    if (!verdict.ok) {
      const entree = {
        agent: agent.id,
        agent_nom: agent.nom,
        declencheur,
        debut: isoLocal(maintenant),
        fin: isoLocal(maintenant),
        statut: 'bloque_budget',
        cout_usd: 0,
        cout_eur: 0,
        taux_usd_eur: this.config.taux_usd_eur,
        duree_ms: 0,
        tours: 0,
        resultat: null,
        fichiers: [],
        erreur: verdict.message,
        modele: null,
        source_cle: null,
        version_claude: null,
      };
      ajouterEntree(this.dossierJournal, entree);
      this.ligne(agent, { ts: isoLocal(maintenant), niveau: 'avertissement', texte: `Lancement refusé : ${verdict.detail}. ${verdict.chiffres}` });
      this.emit('changement');
      return { ok: false, code: 'budget', message: verdict.message, conseil: verdict.conseil, entree };
    }

    this.ligne(agent, {
      ts: isoLocal(maintenant),
      niveau: 'info',
      texte: `Lancement de ${agent.nom} (${declencheur === 'planning' ? 'auto, heure prévue' : declencheur === 'essai' ? 'essai' : 'manuel'})`,
    });

    const passage = executer({
      agent,
      config: this.config,
      racine: this.racine,
      declencheur,
      maintenant: this.maintenant,
      estimationEur: verdict.estimation_eur,
      surLigne: (l) => this.ligne(agent, l),
    });
    const promesse = passage.promesse.then((entree) => {
      this.enCours.delete(id);
      this.emit('changement');
      return entree;
    });
    this.enCours.set(id, {
      debut: isoLocal(maintenant),
      estimation_eur: verdict.estimation_eur,
      arreter: passage.arreter,
      promesse,
    });
    this.emit('changement');
    return { ok: true, promesse };
  }

  /** Lance les agents dont l'heure prévue vient d'arriver. Renvoie leurs identifiants. */
  tickPlanning() {
    const maintenant = this.maintenant();
    const { agents } = this.agents();
    const entrees = this.entrees();
    const lances = [];
    for (const agent of agents) {
      const { etat } = statutPlanning({
        agent, entrees, maintenant, enCours: this.enCours, tolerance_min: this.config.tolerance_retard_min,
      });
      if (etat === 'dans_la_fenetre') {
        const r = this.lancer(agent.id, 'planning');
        if (r.ok || r.code === 'budget') lances.push(agent.id);
      }
    }
    return lances;
  }

  demarrerPlanificateur(intervalleMs = 15000) {
    this.arreterPlanificateur();
    this.minuteurPlanification = setInterval(() => this.tickPlanning(), intervalleMs);
    this.minuteurPlanification.unref?.();
    this.tickPlanning();
  }

  arreterPlanificateur() {
    if (this.minuteurPlanification) clearInterval(this.minuteurPlanification);
    this.minuteurPlanification = null;
  }

  /** Arrête le planificateur et les passages en cours ; attend que leurs lignes de journal soient écrites. */
  async arreter() {
    this.arreterPlanificateur();
    const attente = [];
    for (const passage of this.enCours.values()) {
      passage.arreter('Le cockpit a été arrêté pendant ce passage.');
      attente.push(passage.promesse);
    }
    await Promise.allSettled(attente);
  }
}

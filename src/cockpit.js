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
import {
  chargerDod, construireDemande, construireRelance, derniereSortie, empreinteSortie, etatVerification, ID_JUGE, prochainCheminVerdict,
} from './juge.js';
import { executer } from './lanceur.js';
import { court, isoLocal, jourLocal } from './utilitaires.js';

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

  /**
   * Les agents du dossier agents/. Le Juge ne se lance jamais seul : s'il porte une heure « planning », il est écarté et
   * l'écran le dit, plutôt que de laisser un agent qui juge tourner sans qu'on le demande.
   */
  agents() {
    const { agents, invalides } = chargerAgents(this.racine, this.config.ordre);
    const planifie = agents.find((a) => a.id === ID_JUGE && a.planning);
    if (!planifie) return { agents, invalides };
    return {
      agents: agents.filter((a) => a !== planifie),
      invalides: [...invalides, { id: ID_JUGE, erreur: 'le Juge ne se lance qu\'à la main : retire la ligne « planning » de agents/juge/agent.md' }],
    };
  }

  entrees() {
    return lireRecents(this.dossierJournal, this.maintenant(), 14);
  }

  /** Où en est la vérification par le Juge de chaque agent qui a une definition of done (agents/<id>/dod.md). */
  verifications(agents, entrees) {
    const verifications = {};
    for (const agent of agents) {
      if (agent.id === ID_JUGE) continue;
      const v = etatVerification({ racine: this.racine, agent, entrees, enCours: this.enCours });
      if (v) verifications[agent.id] = v;
    }
    return verifications;
  }

  etat() {
    const { agents, invalides } = this.agents();
    const entrees = this.entrees();
    return construireEtat({
      agents,
      invalides,
      entrees,
      enCours: this.enCours,
      maintenant: this.maintenant(),
      config: this.config,
      claude: this.claude,
      demarrage: this.demarrage,
      verifications: this.verifications(agents, entrees),
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
   * @param {string} id
   * @param {'manuel'|'planning'|'essai'} [declencheur]
   * @param {{complement?:string|null, meta?:object|null, libelle?:string|null}} [options] pour ce passage seulement :
   *   complement ajouté à la consigne (demande au Juge, corrections d'une relance), meta ajouté à la ligne de journal,
   *   libelle ajouté à la ligne « Lancement de… » du journal en direct
   * @returns {{ok:true, promesse:Promise<object>} | {ok:false, code:string, message:string, conseil:string, entree?:object}}
   *   `message` dit ce qui s'est passé ; `conseil` (qui commence par un verbe) dit quoi faire : c'est le texte de l'infobulle.
   */
  lancer(id, declencheur = 'manuel', { complement = null, meta = null, libelle = null } = {}) {
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

    // Le Juge ne part jamais sans demande : un clic sur sa propre ligne choisit l'agent à vérifier.
    if (id === ID_JUGE && !meta?.verification) return this.verifierProchain();

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
      texte: `Lancement de ${agent.nom}${libelle ? ` : ${libelle}` : ''} (${declencheur === 'planning' ? 'auto, heure prévue' : declencheur === 'essai' ? 'essai' : 'manuel'})`,
    });

    const passage = executer({
      agent,
      config: this.config,
      racine: this.racine,
      declencheur,
      maintenant: this.maintenant,
      estimationEur: verdict.estimation_eur,
      surLigne: (l) => this.ligne(agent, l),
      complement,
      meta,
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
      meta,
    });
    this.emit('changement');
    return { ok: true, promesse };
  }

  /**
   * Lance le Juge sur la dernière sortie de l'agent `id` (qui doit avoir un dod.md). Toujours à la demande : le cockpit ne
   * lance jamais le Juge seul. Le budget du Juge compte comme celui des autres agents.
   * Même forme de retour que `lancer`.
   */
  verifier(id) {
    const { agents, invalides } = this.agents();
    const cible = agents.find((a) => a.id === id);
    const refus = (code, message, conseil) => ({ ok: false, code, message, conseil });
    if (!cible) return refus('inconnu', `Aucun agent « ${id} » à vérifier.`, `Vérifie que le dossier agents/${id}/ existe, puis recharge la page.`);
    if (id === ID_JUGE) return refus('juge_sur_juge', 'Le Juge ne se vérifie pas lui-même.', 'Lance le Juge depuis l\'agent dont tu veux vérifier le travail.');
    if (!agents.some((a) => a.id === ID_JUGE)) {
      const invalide = invalides.find((i) => i.id === ID_JUGE);
      return refus(
        'sans_juge',
        invalide ? `Le Juge est illisible : ${invalide.erreur}.` : 'Il n\'y a pas d\'agent Juge dans le dossier agents/.',
        invalide ? `Corrige le fichier agents/${ID_JUGE}/agent.md : ${invalide.erreur}.` : `Crée agents/${ID_JUGE}/agent.md (voir le README), puis recharge la page.`,
      );
    }
    const dod = chargerDod(this.racine, id);
    if (!dod.existe) {
      return refus('sans_dod', `« ${cible.nom} » n'a pas de definition of done : le Juge n'a rien à comparer à son travail.`, `Écris agents/${id}/dod.md (3 à 5 critères numérotés) avant de lancer le Juge sur « ${cible.nom} ».`);
    }
    if (!dod.ok) return refus('dod_illisible', `La definition of done de « ${cible.nom} » est illisible : ${dod.erreur}.`, `Corrige agents/${id}/dod.md : ${dod.erreur}.`);
    const sortie = derniereSortie(this.entrees(), id);
    const empreinte = sortie ? empreinteSortie(this.racine, sortie.resultat) : null;
    if (empreinte === null) {
      return refus('rien_a_verifier', `« ${cible.nom} » n'a rien produit à vérifier.`, `Lance « ${cible.nom} » d'abord : le Juge vérifie ce qu'il vient d'écrire.`);
    }
    const verdict = prochainCheminVerdict(this.racine, id, jourLocal(this.maintenant()));
    return this.lancer(ID_JUGE, 'manuel', {
      complement: construireDemande({ agent: cible, sortie: sortie.resultat, verdict, criteres: dod.criteres }),
      libelle: `vérifie ${cible.nom}`,
      // l'empreinte dit ce qui est jugé : si la sortie change pendant ou après le passage, le verdict ne vaut plus pour elle
      meta: { verification: { agent: id, sortie: sortie.resultat, sortie_sha256: empreinte, verdict } },
    });
  }

  /**
   * Un clic sur la ligne du Juge : il vérifie le premier agent dont la sortie attend un verdict (ou dont le dernier verdict est
   * inutilisable). S'il n'y en a aucun, le refus dit pourquoi : pas de definition of done, rien produit encore, ou déjà jugé.
   */
  verifierProchain() {
    const { agents } = this.agents();
    const entrees = this.entrees();
    const vus = [];
    for (const agent of agents) {
      if (agent.id === ID_JUGE) continue;
      const v = etatVerification({ racine: this.racine, agent, entrees, enCours: this.enCours });
      if (!v) continue;
      if (['a_verifier', 'illisible', 'juge_echec'].includes(v.etat)) return this.verifier(agent.id);
      vus.push({ agent, v });
    }
    const refus = (message, conseil) => ({ ok: false, code: 'rien_a_verifier', message, conseil });
    if (vus.length === 0) {
      return refus('Aucun agent n\'a de definition of done : le Juge n\'a rien à vérifier.', 'Écris un fichier dod.md dans le dossier d\'un agent (voir docs/ecrire-une-dod.md), lance cet agent, puis le Juge.');
    }
    const illisible = vus.find(({ v }) => v.etat === 'dod_illisible');
    if (illisible) {
      return refus(`La definition of done de « ${illisible.agent.nom} » est illisible : ${illisible.v.detail}.`, `Corrige agents/${illisible.agent.id}/dod.md : ${illisible.v.detail}.`);
    }
    const sansSortie = vus.find(({ v }) => v.etat === 'sans_sortie');
    if (sansSortie) {
      return refus(`« ${sansSortie.agent.nom} » n'a rien produit à vérifier.`, `Lance « ${sansSortie.agent.nom} » d'abord : le Juge vérifie ce qu'il vient d'écrire.`);
    }
    return refus('Chaque sortie vérifiable a déjà son verdict.', 'Ouvre le verdict sous l\'agent, ou relance l\'agent : sa nouvelle sortie attendra un nouveau verdict.');
  }

  /**
   * « Relancer avec les corrections » : relance l'agent dont le Juge a rejeté la dernière sortie, avec les corrections numérotées
   * ajoutées à sa consigne pour ce passage. Seulement après un rejet à jour, seulement à la demande. Le Juge, lui, ne repart pas :
   * la nouvelle sortie attend un nouveau clic.
   */
  relancerAvecCorrections(id) {
    const { agents } = this.agents();
    const agent = agents.find((a) => a.id === id);
    if (!agent) {
      return { ok: false, code: 'inconnu', message: `Aucun agent « ${id} » dans le dossier agents/.`, conseil: `Vérifie que le dossier agents/${id}/ existe, puis recharge la page.` };
    }
    const entrees = this.entrees();
    const v = etatVerification({ racine: this.racine, agent, entrees, enCours: this.enCours });
    if (v?.etat !== 'rejete') {
      return {
        ok: false,
        code: 'pas_de_rejet',
        message: `Aucun rejet à jour pour « ${agent.nom} » : rien à corriger.`,
        conseil: `Lance le Juge sur « ${agent.nom} » : s'il rejette sa sortie, « Relancer avec les corrections » devient possible.`,
      };
    }
    return this.lancer(id, 'manuel', {
      complement: construireRelance({ sortie: derniereSortie(entrees, id).resultat, corrections: v.verdict.corrections }),
      libelle: 'relance avec les corrections du Juge',
      meta: { relance_corrections: { verdict: v.verdict.chemin } },
    });
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

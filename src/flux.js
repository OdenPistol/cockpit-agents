// Transforme le flux « stream-json » de Claude Code en lignes courtes, lisibles, en français.
// À l'écran, jamais de JSON brut : « Lit data/veille/sources.md », « Écrit out/veille/… », etc.
//
// Événements lus (documentation Claude Code, vérifiés sur la version 2.1.306) :
//   system/init                 version, modèle, outils, apiKeySource
//   system/thinking_tokens      Claude réfléchit (le contenu n'est pas exposé)
//   system/api_retry            nouvelle tentative après une erreur de l'API
//   assistant (text, tool_use)  ce que dit Claude, l'outil qu'il appelle
//   user (tool_result)          le retour d'un outil, en erreur si le droit a été refusé
//   rate_limit_event            état de la limite d'usage de l'abonnement
//   result                      fin du passage : total_cost_usd, duration_ms, num_turns
// Tout événement inconnu est ignoré : une nouvelle version de Claude Code ne casse pas l'écran.

import path from 'node:path';
import { compte, court, minusculeInitiale, nettoyerChemins } from './utilitaires.js';

export class FormateurFlux {
  /**
   * @param {{racine:string, home:string, cwd?:string}} contexte dossiers à masquer dans ce qui s'affiche,
   *   et dossier de travail de l'agent (pour lire un chemin relatif comme « ../../data »)
   */
  constructor({ racine, home, cwd = null }) {
    this.racine = racine;
    this.home = home;
    this.cwd = cwd;
    this.init = null;
    this.resultat = null;
    this.outils = new Map(); // tool_use_id → { nom, entree }
    this.penseeAnnoncee = false;
  }

  /** Chemin affichable : relatif au projet quand c'est possible, « ~ » pour le dossier personnel. */
  chemin(p) {
    if (typeof p !== 'string' || p === '') return 'un fichier';
    return nettoyerChemins(p, { racine: this.racine, home: this.home });
  }

  /** Chemin passé à un outil : un chemin relatif (« ../../data ») se lit depuis le dossier de travail de l'agent. */
  fichier(p) {
    if (typeof p !== 'string' || !this.cwd || path.isAbsolute(p) || p.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return this.chemin(p);
    return this.chemin(path.resolve(this.cwd, p));
  }

  /** Décrit un appel d'outil en une phrase. */
  decrire(nom, entree = {}) {
    switch (nom) {
      case 'Read':
        return { type: 'lecture', texte: `Lit ${this.fichier(entree.file_path)}` };
      case 'Write': {
        const taille = typeof entree.content === 'string' ? ` (${compte(entree.content.length, 'caractère')})` : '';
        return { type: 'ecriture', texte: `Écrit ${this.fichier(entree.file_path)}${taille}` };
      }
      case 'Edit':
      case 'MultiEdit':
        return { type: 'ecriture', texte: `Modifie ${this.fichier(entree.file_path)}` };
      case 'NotebookEdit':
        return { type: 'ecriture', texte: `Modifie ${this.fichier(entree.notebook_path)}` };
      case 'Glob':
        return { type: 'recherche', texte: `Cherche les fichiers « ${court(entree.pattern, 80)} »${entree.path ? ` dans ${this.fichier(entree.path)}` : ''}` };
      case 'Grep':
        return { type: 'recherche', texte: `Cherche « ${court(entree.pattern, 80)} »${entree.path ? ` dans ${this.fichier(entree.path)}` : ''}` };
      case 'WebFetch':
        return { type: 'web', texte: `Ouvre la page ${court(entree.url, 120)}` };
      case 'WebSearch':
        return { type: 'web', texte: `Cherche sur le web « ${court(entree.query, 100)} »` };
      case 'Bash':
        return { type: 'commande', texte: `Lance une commande : ${court(this.chemin(entree.command), 120)}` };
      case 'TodoWrite':
        return { type: 'autre', texte: 'Met à jour sa liste de tâches' };
      case 'Task':
      case 'Agent':
        return { type: 'autre', texte: 'Confie une tâche à un sous-agent' };
      default:
        return { type: 'autre', texte: `Utilise l'outil ${nom}` };
    }
  }

  /**
   * Traite un événement du flux.
   * @returns {{niveau:'info'|'action'|'texte'|'avertissement'|'erreur', type?:string, texte:string}[]}
   */
  traiter(evenement) {
    if (evenement === null || typeof evenement !== 'object') return [];
    const lignes = [];

    switch (evenement.type) {
      case 'system':
        return this.traiterSysteme(evenement);

      case 'assistant': {
        const blocs = evenement.message?.content;
        if (!Array.isArray(blocs)) return [];
        for (const bloc of blocs) {
          if (bloc?.type === 'text' && typeof bloc.text === 'string' && bloc.text.trim() !== '') {
            this.penseeAnnoncee = false;
            lignes.push({ niveau: 'texte', type: 'reponse', texte: `Claude répond « ${court(this.chemin(bloc.text), 300)} »` });
          } else if (bloc?.type === 'tool_use') {
            this.penseeAnnoncee = false;
            this.outils.set(bloc.id, { nom: bloc.name, entree: bloc.input ?? {} });
            const { type, texte } = this.decrire(bloc.name, bloc.input ?? {});
            lignes.push({ niveau: 'action', type, texte });
          }
        }
        return lignes;
      }

      case 'user': {
        const blocs = evenement.message?.content;
        if (!Array.isArray(blocs)) return [];
        for (const bloc of blocs) {
          if (bloc?.type !== 'tool_result' || bloc.is_error !== true) continue;
          const outil = this.outils.get(bloc.tool_use_id) ?? { nom: 'un outil', entree: {} };
          lignes.push(this.decrireErreurOutil(outil, bloc.content));
        }
        return lignes;
      }

      case 'result':
        this.resultat = evenement;
        return [];

      case 'rate_limit_event':
        if (evenement.rate_limit_info?.status === 'rejected') {
          return [{ niveau: 'avertissement', texte: 'Limite d\'usage atteinte : Claude Code peut refuser la suite.' }];
        }
        return [];

      default:
        return [];
    }
  }

  traiterSysteme(evenement) {
    switch (evenement.subtype) {
      case 'init':
        this.init = evenement;
        return [{
          niveau: 'info',
          texte: `Claude Code ${evenement.claude_code_version ?? ''} démarré · modèle ${evenement.model ?? 'inconnu'} · ${compte(Array.isArray(evenement.tools) ? evenement.tools.length : 0, 'outil')}`.replace(/\s+/g, ' '),
        }];
      case 'thinking_tokens':
        if (this.penseeAnnoncee) return [];
        this.penseeAnnoncee = true;
        return [{ niveau: 'info', texte: 'Réfléchit…' }];
      case 'api_retry':
        return [{
          niveau: 'avertissement',
          texte: `Nouvelle tentative (${evenement.attempt ?? '?'}/${evenement.max_retries ?? '?'}) après une erreur « ${evenement.error ?? 'inconnue'} »`,
        }];
      default:
        return [];
    }
  }

  decrireErreurOutil(outil, contenu) {
    const texte = typeof contenu === 'string'
      ? contenu
      : Array.isArray(contenu) ? contenu.map((b) => b?.text ?? '').join(' ') : '';
    if (/has been denied|permission.*denied|refusé/i.test(texte)) {
      const cible = this.fichier(outil.entree.file_path ?? outil.entree.notebook_path ?? outil.entree.path ?? outil.entree.url);
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(outil.nom)) {
        return { niveau: 'erreur', type: 'refus', texte: `Refusé : rien n'a été écrit dans ${cible}, hors du dossier de sortie de l'agent` };
      }
      if (outil.nom === 'Read') return { niveau: 'erreur', type: 'refus', texte: `Refusé : lecture non autorisée de ${cible}` };
      return { niveau: 'erreur', type: 'refus', texte: `Refusé : l'outil ${outil.nom} n'est pas autorisé pour cet agent` };
    }
    return { niveau: 'erreur', type: 'erreur', texte: `Erreur de l'outil ${outil.nom} : ${minusculeInitiale(court(this.chemin(texte), 160))}` };
  }
}

// Le journal : un fichier JSONL par jour dans journal/ (AAAA-MM-JJ.jsonl), une ligne par passage.
// C'est la seule source des chiffres affichés à l'écran.
//
// Champs d'une ligne :
//   agent, agent_nom, declencheur (manuel | planning | essai)
//   debut, fin            dates ISO en heure locale (ex. 2026-10-21T12:01:16+02:00)
//   statut                reussi | echec | bloque_budget
//   cout_usd, cout_eur    coût renvoyé par Claude Code (total_cost_usd) puis converti ; null si inconnu
//   taux_usd_eur          le taux utilisé pour la conversion de cette ligne
//   duree_ms, tours       lus dans l'événement final « result » de Claude Code
//   resultat, fichiers    chemin du fichier produit (le plus récent) et liste des fichiers écrits
//   erreur                message lisible si le passage a échoué ou a été refusé
//   modele, source_cle, version_claude   lus dans l'événement « init » de Claude Code
//   bilan                 ce qu'a fait un passage réussi, en une ligne écrite par l'agent (voir bilan.js) ; null sinon
//   etapes                les lignes du journal en direct de ce passage (les 80 dernières), que l'écran remontre au repos

import fs from 'node:fs';
import path from 'node:path';
import { jourLocal } from './utilitaires.js';

export function cheminJournal(dossier, jour) {
  return path.join(dossier, `${jour}.jsonl`);
}

/** Ajoute une ligne au journal du jour de `entree.debut`. */
export function ajouterEntree(dossier, entree) {
  fs.mkdirSync(dossier, { recursive: true });
  const jour = jourLocal(new Date(entree.debut));
  fs.appendFileSync(cheminJournal(dossier, jour), `${JSON.stringify(entree)}\n`, 'utf8');
}

/** Lit le journal d'un jour. Une ligne abîmée est ignorée plutôt que de tout bloquer. */
export function lireJour(dossier, jour) {
  let texte;
  try {
    texte = fs.readFileSync(cheminJournal(dossier, jour), 'utf8');
  } catch {
    return [];
  }
  const entrees = [];
  for (const ligne of texte.split('\n')) {
    if (ligne.trim() === '') continue;
    try {
      const e = JSON.parse(ligne);
      if (e && typeof e === 'object' && typeof e.agent === 'string' && typeof e.debut === 'string') entrees.push(e);
    } catch {
      // ligne incomplète (écriture interrompue) : on passe
    }
  }
  return entrees;
}

/** Lit les `nbJours` derniers jours (aujourd'hui compris), triés du plus ancien au plus récent. */
export function lireRecents(dossier, maintenant, nbJours = 14) {
  const entrees = [];
  for (let i = 0; i < nbJours; i += 1) {
    const jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - i);
    entrees.push(...lireJour(dossier, jourLocal(jour)));
  }
  return entrees.sort((a, b) => new Date(a.debut) - new Date(b.debut));
}

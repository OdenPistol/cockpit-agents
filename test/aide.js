// Outils partagés par les tests : un faux projet dans un dossier temporaire, avec un faux « claude ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAUTS } from '../src/config.js';
import { isoLocal } from '../src/utilitaires.js';

// Tutoiement dans un texte qui doit vouvoyer (les deux README) : pronoms et possessifs de la deuxième personne du
// singulier, et impératifs (« tape », « ouvre »...) écrits en début de ligne, d'élément de liste ou de proposition.
// « il ouvre » ou « un agent lance » (troisième personne) ne sont jamais pris pour des impératifs : le verbe doit suivre
// directement un début de ligne ou un signe de ponctuation (point, deux-points, point-virgule, virgule, « ! », « ? »).
const IMPERATIFS_TU = ['récupère', 'décompresse', 'ouvre', 'tape', 'glisse', 'appuie', 'installe', 'lance', 'crée', 'recharge', 'remplace', 'copie', 'ajoute', 'demande', 'mets', 'écris', 'retire', 'relève', 'change', 'regarde', 'vérifie', 'clique', 'garde', 'utilise', 'supprime', 'modifie', 'fais', 'lis', 'attends', 'choisis'];
const LETTRE = String.raw`[\p{L}\p{N}_]`;
export const TUTOIEMENT = new RegExp([
  String.raw`(?<!${LETTRE})(?:tu|toi|ton|ta|tes|te|tien|tienne|tiens|tiennes)(?!${LETTRE})`,
  String.raw`(?<!${LETTRE})t'`,
  String.raw`(?:^|\n)\s*(?:[-*]\s+|\d+\.\s+)?(?:${IMPERATIFS_TU.join('|')})(?!${LETTRE})`,
  String.raw`[.:;,!?»)]\s+(?:${IMPERATIFS_TU.join('|')})(?!${LETTRE})`,
].join('|'), 'iu');

export const RACINE_REELLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FAUX_CLAUDE = path.join(RACINE_REELLE, 'test', 'fixtures', 'fake-claude.js');
fs.chmodSync(FAUX_CLAUDE, 0o755); // un dossier téléchargé en ZIP peut avoir perdu le droit d'exécution

export function agentMd({
  nom = 'Agent de test',
  description = 'Un agent pour les tests.',
  planning = null,
  budget = 0.5,
  outils = 'Read, Write, Glob, Grep',
  tours = 5,
  prompt = 'Fais le travail.',
} = {}) {
  return [
    '---',
    `nom: ${nom}`,
    `description: ${description}`,
    ...(planning ? [`planning: ${planning}`] : []),
    `budget_jour_eur: ${budget}`,
    `outils: ${outils}`,
    `max_tours: ${tours}`,
    '---',
    prompt,
    '',
  ].join('\n');
}

/**
 * Crée un faux projet : agents/, data/, out/, journal/, public/ (copie du vrai).
 * @param {Record<string,string>} agents identifiant → contenu de agent.md
 */
export function creerProjet(agents = { alpha: agentMd() }) {
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-')));
  for (const dossier of ['data', 'out', 'journal']) fs.mkdirSync(path.join(racine, dossier));
  fs.writeFileSync(path.join(racine, 'data', 'lisez-moi.txt'), 'bonjour\n');
  for (const [id, contenu] of Object.entries(agents)) {
    fs.mkdirSync(path.join(racine, 'agents', id), { recursive: true });
    fs.writeFileSync(path.join(racine, 'agents', id, 'agent.md'), contenu);
  }
  fs.cpSync(path.join(RACINE_REELLE, 'public'), path.join(racine, 'public'), { recursive: true });
  return racine;
}

export function configTest(surcharges = {}) {
  return { ...DEFAUTS, commande_claude: FAUX_CLAUDE, ouvrir_navigateur: false, port: 0, ...surcharges };
}

export function nettoyer(racine) {
  fs.rmSync(racine, { recursive: true, force: true });
}

/** Entrée de journal minimale pour les tests de coût et d'alertes (par défaut : le 21/10/2026 à 08:00, heure locale). */
export function entree(surcharges = {}) {
  return {
    agent: 'alpha',
    agent_nom: 'Alpha',
    declencheur: 'manuel',
    debut: isoLocal(new Date(2026, 9, 21, 8, 0, 0)),
    fin: isoLocal(new Date(2026, 9, 21, 8, 0, 30)),
    statut: 'reussi',
    cout_usd: 0.1,
    cout_eur: 0.086,
    taux_usd_eur: 0.86,
    duree_ms: 30000,
    tours: 3,
    resultat: null,
    fichiers: [],
    erreur: null,
    ...surcharges,
  };
}

/** Date locale (le fuseau de la machine ne change pas les tests). */
export function date(h, m = 0, jour = 21, mois = 10, annee = 2026) {
  return new Date(annee, mois - 1, jour, h, m, 0, 0);
}

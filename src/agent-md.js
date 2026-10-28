// Lecture des fichiers agent.md : un bloc d'en-tête (frontmatter) puis la consigne en Markdown.
//
// ---
// nom: Veille
// description: Résume les nouveautés IA du jour.
// planning: 07:30            (facultatif, format HH:MM)
// budget_jour_eur: 0.50
// outils: Read, Write, Glob, Grep
// max_tours: 10
// ---
// La consigne de l'agent, en Markdown. Elle est transmise telle quelle à Claude Code.

import fs from 'node:fs';
import path from 'node:path';

export class AgentMdError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentMdError';
  }
}

const OBLIGATOIRES = ['nom', 'description', 'budget_jour_eur', 'outils', 'max_tours'];
const CLES = new Set([...OBLIGATOIRES, 'planning']);
const RE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_OUTIL = /^([A-Z][A-Za-z0-9_]*)(\(.*\))?$/;
const RE_HEURE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
// Un nom de domaine seul : des mots de lettres, chiffres et tirets séparés par des points. Ni « * », ni adresse, ni chemin.
const RE_DOMAINE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * WebFetch sans domaine laisserait l'agent ouvrir n'importe quelle page du web : on exige « WebFetch(domain:example.org) »,
 * un domaine par entrée. Les autres outils passent tels quels.
 */
function verifierWebFetch(entree) {
  if (nomOutil(entree) !== 'WebFetch') return;
  if (entree === 'WebFetch') {
    throw new AgentMdError('« WebFetch » seul laisserait l\'agent ouvrir n\'importe quelle page du web : écris « WebFetch(domain:example.org) », un domaine par site de confiance');
  }
  const domaine = /^WebFetch\(domain:([^()]*)\)$/.exec(entree)?.[1];
  if (domaine === undefined || !RE_DOMAINE.test(domaine)) {
    throw new AgentMdError(`« ${entree} » n'est pas valable : écris « WebFetch(domain:example.org) », avec le nom d'un seul domaine (ni « * », ni adresse complète, ni chemin)`);
  }
}

/** Retire les guillemets qui entourent une valeur, s'il y en a. */
function sansGuillemets(valeur) {
  const v = valeur.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Retire un commentaire de fin de ligne (« valeur  # remarque ») si la valeur n'est pas entre guillemets. */
function sansCommentaire(valeur) {
  const v = valeur.trim();
  if (v.startsWith('"') || v.startsWith("'")) return v;
  const i = v.search(/\s#/);
  return i >= 0 ? v.slice(0, i).trim() : v;
}

/** Découpe « Read, Write, Bash(git status) » sans couper à l'intérieur des parenthèses. */
function decouperListe(valeur) {
  let v = valeur.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  const morceaux = [];
  let profondeur = 0;
  let courant = '';
  for (const c of v) {
    if (c === '(') profondeur += 1;
    if (c === ')') profondeur -= 1;
    if (profondeur < 0) throw new AgentMdError('« outils » : parenthèse fermante en trop');
    if (c === ',' && profondeur === 0) {
      morceaux.push(courant);
      courant = '';
    } else {
      courant += c;
    }
  }
  if (profondeur !== 0) throw new AgentMdError('« outils » : parenthèse non fermée');
  morceaux.push(courant);
  return morceaux.map((m) => sansGuillemets(m)).filter((m) => m.length > 0);
}

/**
 * Lit le texte d'un agent.md.
 * @param {string} texte contenu du fichier
 * @param {string} id nom du dossier de l'agent (ex. « rapport-du-matin »)
 * @returns {{id, nom, description, planning, budget_jour_eur, outils, max_tours, prompt}}
 * @throws {AgentMdError} avec un message en français qui dit où est le problème
 */
export function lireAgentMd(texte, id) {
  const brut = String(texte).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lignes = brut.split('\n');

  if (lignes[0].trim() !== '---') {
    throw new AgentMdError('le fichier doit commencer par une ligne « --- » qui ouvre l\'en-tête');
  }
  const fermeture = lignes.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (fermeture === -1) {
    throw new AgentMdError('l\'en-tête n\'est pas fermé : il manque une seconde ligne « --- »');
  }

  const valeurs = {};
  for (let i = 1; i < fermeture; i += 1) {
    const ligne = lignes[i];
    if (ligne.trim() === '' || ligne.trim().startsWith('#')) continue;
    const m = /^([a-z_]+)\s*:\s*(.*)$/.exec(ligne);
    if (!m) throw new AgentMdError(`ligne ${i + 1} illisible : « ${ligne.trim()} » (attendu : clé: valeur)`);
    const [, cle, valeur] = m;
    if (!CLES.has(cle)) {
      throw new AgentMdError(`ligne ${i + 1} : clé inconnue « ${cle} » (clés possibles : ${[...CLES].join(', ')})`);
    }
    if (cle in valeurs) throw new AgentMdError(`ligne ${i + 1} : la clé « ${cle} » est écrite deux fois`);
    valeurs[cle] = sansCommentaire(valeur);
  }

  for (const cle of OBLIGATOIRES) {
    if (!(cle in valeurs) || valeurs[cle] === '') {
      throw new AgentMdError(`la clé « ${cle} » est obligatoire`);
    }
  }

  const nom = sansGuillemets(valeurs.nom);
  if (nom.length > 40) throw new AgentMdError('« nom » est trop long (40 caractères au plus)');

  const description = sansGuillemets(valeurs.description);
  if (description.length > 140) throw new AgentMdError('« description » est trop longue (140 caractères au plus)');

  let planning = null;
  if ('planning' in valeurs && valeurs.planning !== '') {
    const p = RE_HEURE.exec(sansGuillemets(valeurs.planning));
    if (!p) throw new AgentMdError(`« planning » doit être une heure au format HH:MM (ex. 07:30), pas « ${valeurs.planning} »`);
    planning = `${p[1].padStart(2, '0')}:${p[2]}`;
  }

  const budget = Number(sansGuillemets(valeurs.budget_jour_eur).replace(',', '.'));
  if (!Number.isFinite(budget) || budget <= 0 || budget > 100) {
    throw new AgentMdError(`« budget_jour_eur » doit être un nombre d'euros positif (ex. 0.50), pas « ${valeurs.budget_jour_eur} »`);
  }

  const brutTours = sansGuillemets(valeurs.max_tours);
  if (!/^\d+$/.test(brutTours) || Number(brutTours) < 1 || Number(brutTours) > 100) {
    throw new AgentMdError(`« max_tours » doit être un entier entre 1 et 100, pas « ${valeurs.max_tours} »`);
  }

  const outils = [];
  for (const entree of decouperListe(valeurs.outils)) {
    if (entree.startsWith('mcp__')) {
      throw new AgentMdError(`« ${entree} » : les outils MCP ne sont pas pris en charge dans cette démo`);
    }
    if (!RE_OUTIL.test(entree)) {
      throw new AgentMdError(`« ${entree} » n'est pas un nom d'outil valide (exemples : Read, Write, Glob, Grep, WebFetch(domain:example.org))`);
    }
    verifierWebFetch(entree);
    if (!outils.includes(entree)) outils.push(entree);
  }
  if (outils.length === 0) throw new AgentMdError('« outils » ne contient aucun outil');

  const prompt = lignes.slice(fermeture + 1).join('\n').trim();
  if (prompt === '') throw new AgentMdError('la consigne (le texte après l\'en-tête) est vide');
  if (prompt.length > 20000) throw new AgentMdError('la consigne est trop longue (20 000 caractères au plus)');

  if (id !== undefined && !RE_ID.test(id)) {
    throw new AgentMdError(`le nom du dossier « ${id} » ne convient pas : minuscules, chiffres et tirets seulement (ex. rapport-du-matin)`);
  }

  return { id, nom, description, planning, budget_jour_eur: budget, outils, max_tours: Number(brutTours), prompt };
}

/** Nom de l'outil sans sa partie entre parenthèses : « Bash(ls) » → « Bash ». */
export function nomOutil(entree) {
  return RE_OUTIL.exec(entree)?.[1] ?? entree;
}

/**
 * Lit tous les agents du dossier `agents/` (un sous-dossier par agent).
 * Un agent illisible n'empêche pas les autres de fonctionner : il est renvoyé dans `invalides`.
 * @param {string} racine dossier du projet
 * @param {string[]} ordre identifiants à placer en premier, dans cet ordre
 */
export function chargerAgents(racine, ordre = []) {
  const dossier = path.join(racine, 'agents');
  let noms = [];
  try {
    noms = fs.readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    noms = [];
  }

  const agents = [];
  const invalides = [];
  for (const id of noms) {
    try {
      if (!RE_ID.test(id)) {
        throw new AgentMdError(`le nom du dossier « ${id} » ne convient pas : minuscules, chiffres et tirets seulement (ex. rapport-du-matin)`);
      }
      const fichier = path.join(dossier, id, 'agent.md');
      if (!fs.existsSync(fichier)) throw new AgentMdError('le fichier agent.md est introuvable dans ce dossier');
      const agent = lireAgentMd(fs.readFileSync(fichier, 'utf8'), id);
      agent.modifie = fs.statSync(fichier).mtime; // sert à dire la cause d'un retard : agent créé ou modifié après l'heure prévue
      agents.push(agent);
    } catch (e) {
      if (!(e instanceof AgentMdError)) throw e;
      invalides.push({ id, erreur: e.message });
    }
  }

  const rang = (id) => {
    const i = ordre.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const tri = (a, b) => rang(a.id) - rang(b.id) || a.id.localeCompare(b.id);
  agents.sort(tri);
  invalides.sort(tri);
  return { agents, invalides };
}

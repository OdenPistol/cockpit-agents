// Ce qu'un agent a fait, en une ligne, pour l'écran : toujours un texte écrit par l'agent lui-même,
// jamais un chiffre calculé ou deviné par le cockpit.
//
// Ordre de recherche, pour un passage réussi :
//   1. dans son fichier de sortie, une ligne « Bilan : … » (en gras ou non) ;
//   2. dans son fichier de sortie, la ligne de chiffres juste sous le titre (« 17 à traiter · 10 factures · … ») ;
//   3. dans son message final, la première ligne utile (ni vide, ni titre, ni simple chemin de fichier) ;
//   4. dans son fichier de sortie, son début : la première ligne de texte, entre « » (c'est un extrait) ; si le fichier
//      commence par une liste ou par un bloc de trois lignes ou plus (un sujet par ligne), son titre seul
//      (« Point du matin : mercredi »), car sa première ligne ne parlerait que du premier sujet.
// Rien de tout cela : null, et l'écran garde la description de l'agent.

import { court } from './utilitaires.js';

const LONGUEUR_MAX = 240;
const LIGNES_LUES = 40;

/** Retire la mise en forme Markdown d'une ligne : puce, gras, code, liens. */
export function texteSimple(ligne) {
  return String(ligne)
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const estTitre = (l) => /^\s*#{1,6}\s/.test(l);
const estTableau = (l) => /^\s*\|/.test(l);
const estListe = (l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
const estRegle = (l) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l);
// une ligne qui ne fait que donner un chemin de fichier (« out/veille/veille-2026-10-28.md », « Fichier écrit : … »)
const estChemin = (l) => /(?:^|[\s`:])(?:\.{1,2}\/|~\/|\/|out\/)?[\w.À-ſ-]+(?:\/[\w.À-ſ-]+)+\.\w{1,5}`?\s*\.?$/.test(l.trim())
  && texteSimple(l).split(' ').length <= 6;
const fini = (t) => (t ? court(t, LONGUEUR_MAX) : null);

/** La ligne de bilan d'un fichier de sortie (règles 1 et 2), ou null. */
export function bilanDuFichier(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return null;
  const lignes = texte.replace(/\r\n?/g, '\n').split('\n').slice(0, LIGNES_LUES);
  for (const l of lignes) {
    const m = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?bilan(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/i.exec(l);
    if (m) {
      const t = texteSimple(m[1]);
      if (t) return fini(t);
    }
  }
  const contenu = lignes.filter((l) => l.trim() !== '' && !estTitre(l) && !estRegle(l));
  for (const l of contenu.slice(0, 3)) {
    if (estTableau(l) || estListe(l)) break;
    if (/\d/.test(l) && /\s·\s/.test(l)) return fini(texteSimple(l));
  }
  return null;
}

/** La première ligne utile du message final de l'agent (règle 3), ou null. */
export function ligneDuMessage(message) {
  if (typeof message !== 'string') return null;
  for (const l of message.replace(/\r\n?/g, '\n').split('\n')) {
    if (l.trim() === '' || estTitre(l) || estTableau(l) || estRegle(l) || estChemin(l)) continue;
    const t = texteSimple(l).replace(/^bilan\s*:\s*/i, '');
    if (t) return fini(t);
  }
  return null;
}

/** Le début du fichier quand il n'a pas de ligne de bilan (règle 4), ou null. */
export function extraitDuFichier(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return null;
  const lignes = texte.replace(/\r\n?/g, '\n').split('\n');
  const titre = lignes.find(estTitre);
  const nom = titre ? texteSimple(titre.replace(/^\s*#{1,6}\s+/, '')) : '';
  const debut = lignes.findIndex((l) => l.trim() !== '' && !estTitre(l) && !estRegle(l));
  if (debut < 0 || estTableau(lignes[debut])) return null;
  // le premier bloc : les lignes qui se suivent, jusqu'à une ligne vide ou un titre
  const bloc = [];
  for (let i = debut; i < lignes.length && lignes[i].trim() !== '' && !estTitre(lignes[i]) && !estTableau(lignes[i]); i += 1) bloc.push(lignes[i]);
  // une liste, ou un point de plusieurs lignes (« Point du matin » : une ligne par sujet) : son titre, tel qu'il l'a écrit
  if (nom && (estListe(bloc[0]) || bloc.length >= 3)) return fini(nom);
  const t = texteSimple(bloc[0]);
  return t ? fini(`« ${t} »`) : null;
}

/**
 * Ce qu'a fait un passage, en une ligne.
 * @param {{statut:string, texteFichier?:string|null, messageFinal?:string|null}} p
 *   texteFichier : contenu du fichier de sortie (null s'il manque) ; messageFinal : dernier texte de l'agent
 * @returns {string|null}
 */
export function ceQuIlAFait({ statut, texteFichier = null, messageFinal = null }) {
  if (statut !== 'reussi') return null;
  return bilanDuFichier(texteFichier) ?? ligneDuMessage(messageFinal) ?? extraitDuFichier(texteFichier);
}

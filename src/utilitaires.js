// Petits outils partagés : dates en heure locale, montants en euros, nettoyage de chemins.

const p2 = (n) => String(n).padStart(2, '0');

/** « 2026-10-21 » en heure locale de la machine. */
export function jourLocal(date) {
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

/** « 12:01 » en heure locale. */
export function heureLocale(date) {
  return `${p2(date.getHours())}:${p2(date.getMinutes())}`;
}

/**
 * Date ISO avec le décalage horaire local, par exemple « 2026-10-21T12:01:16+02:00 ».
 * Le journal reste ainsi lisible à l'œil, en heure de la machine.
 */
export function isoLocal(date) {
  const decalage = -date.getTimezoneOffset();
  const signe = decalage >= 0 ? '+' : '-';
  const abs = Math.abs(decalage);
  return `${jourLocal(date)}T${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}${signe}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/** Montant en euros à la française : « 0,48 € ». */
export function eur(valeur, decimales = 2) {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return 'inconnu';
  return `${valeur.toFixed(decimales).replace('.', ',')} €`;
}

/** Arrondi à n décimales, sans surprise de virgule flottante visible. */
export function arrondir(valeur, decimales = 6) {
  const f = 10 ** decimales;
  return Math.round(valeur * f) / f;
}

/** Compare deux montants en micro-euros : évite 0.1 + 0.2 > 0.3. */
export function microEuros(valeur) {
  return Math.round(valeur * 1e6);
}

/** Aujourd'hui (selon `maintenant`) à l'heure « HH:MM » donnée. */
export function aujourdhuiA(maintenant, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h, m, 0, 0);
}

/** Raccourcit un texte sur une seule ligne. */
export function court(texte, max = 200) {
  const ligne = String(texte ?? '').replace(/\s+/g, ' ').trim();
  return ligne.length > max ? `${ligne.slice(0, max - 1).trimEnd()}…` : ligne;
}

/**
 * Remplace dans un texte les chemins absolus par des chemins courts :
 * le dossier du projet disparaît, le dossier personnel devient « ~ ».
 * Évite d'afficher (ou d'enregistrer) le nom de l'utilisateur de la machine.
 */
export function nettoyerChemins(texte, { racine, home }) {
  let sortie = String(texte ?? '');
  if (racine) sortie = sortie.split(`${racine}/`).join('').split(racine).join('.');
  if (home) sortie = sortie.split(home).join('~');
  return sortie;
}

// Mots qui gardent leur majuscule même derrière un deux-points.
const GARDENT_LA_MAJUSCULE = new Set(['Claude', 'Node', 'Mac', 'API', 'JSON', 'MCP', 'Anthropic']);

/**
 * Met la première lettre en minuscule, pour une phrase qui suit un deux-points :
 * « Nombre maximal… » devient « nombre maximal… ». Un sigle (« API »), un nom propre connu
 * (« Claude Code ») ou un texte qui commence par autre chose qu'une majuscule suivie d'une minuscule ne bouge pas.
 */
export function minusculeInitiale(texte) {
  const t = String(texte ?? '');
  const premierMot = t.split(/[\s,;:.()«»]/)[0];
  if (GARDENT_LA_MAJUSCULE.has(premierMot) || !/^\p{Lu}\p{Ll}/u.test(t)) return t;
  return t[0].toLowerCase() + t.slice(1);
}

/**
 * Le mot qui suit un nombre : en français, zéro et un restent au singulier, le pluriel commence à deux
 * (« 0 outil », « 1 outil », « 2 outils »). Un nombre inconnu (« ? ») garde le pluriel.
 * Le même calcul est écrit dans public/app.js, qui ne peut rien importer : test/ui.test.js vérifie qu'ils s'accordent.
 */
export function plurielSi(n, singulier, pluriel = `${singulier}s`) {
  const connu = typeof n === 'number' || (typeof n === 'string' && n.trim() !== '');
  const nombre = connu ? Number(n) : Number.NaN;
  return Number.isFinite(nombre) && Math.abs(nombre) < 2 ? singulier : pluriel;
}

/** Un nombre et son nom accordé : « 1 outil », « 3 outils ». */
export function compte(n, singulier, pluriel) {
  return `${n} ${plurielSi(n, singulier, pluriel)}`;
}

/** Durée lisible : « 23 s », « 1 min 05 s ». */
export function duree(ms) {
  if (ms === null || ms === undefined) return 'inconnue';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${p2(s % 60)} s`;
}

// Lecture de config.json, avec des valeurs par défaut et des messages d'erreur en français.

import fs from 'node:fs';
import path from 'node:path';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAUTS = {
  port: 4321,
  taux_usd_eur: 0.86,
  plafond_jour_eur: 3,
  estimation_defaut_eur: 0.15,
  modele: 'sonnet',
  configuration_isolee: true,
  commande_claude: 'claude',
  delai_max_s: 600,
  tolerance_retard_min: 3,
  ordre: [],
  abonnement: 'auto',
  ouvrir_navigateur: true,
};

// Clés dont le nom a changé : l'ancien nom reçoit un message qui donne le nouveau, pas un simple « n'existe pas ».
const RENOMMEES = { configuration_propre: 'configuration_isolee' };

const verifs = {
  port: (v) => Number.isInteger(v) && v >= 0 && v <= 65535 || 'un numéro de port entre 0 et 65535',
  taux_usd_eur: (v) => typeof v === 'number' && v > 0 && v < 10 || 'un nombre positif (euros pour 1 dollar, ex. 0.86)',
  plafond_jour_eur: (v) => typeof v === 'number' && v > 0 && v <= 10000 || 'un nombre positif d\'euros (ex. 3)',
  estimation_defaut_eur: (v) => typeof v === 'number' && v >= 0 && v <= 100 || 'un nombre d\'euros positif ou nul (ex. 0.15)',
  modele: (v) => typeof v === 'string' || 'un texte (ex. "sonnet"), ou "" pour garder le modèle par défaut de ton compte',
  configuration_isolee: (v) => typeof v === 'boolean' || 'true ou false',
  commande_claude: (v) => typeof v === 'string' && v.trim() !== '' || 'le nom ou le chemin de la commande claude',
  delai_max_s: (v) => Number.isInteger(v) && v >= 10 && v <= 7200 || 'un nombre entier de secondes entre 10 et 7200',
  tolerance_retard_min: (v) => typeof v === 'number' && v >= 1 && v <= 120 || 'un nombre de minutes entre 1 et 120',
  ordre: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') || 'une liste d\'identifiants d\'agents',
  abonnement: (v) => ['auto', 'oui', 'non'].includes(v) || '"auto", "oui" ou "non"',
  ouvrir_navigateur: (v) => typeof v === 'boolean' || 'true ou false',
};

/** Complète les valeurs manquantes et refuse ce qui est invalide. */
export function validerConfig(brut) {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) {
    throw new ConfigError('config.json doit contenir un objet JSON entre accolades { }');
  }
  for (const cle of Object.keys(brut)) {
    if (cle in RENOMMEES) {
      throw new ConfigError(`config.json : la clé « ${cle} » s'appelle maintenant « ${RENOMMEES[cle]} » (même sens : renomme-la)`);
    }
    if (!(cle in DEFAUTS)) {
      throw new ConfigError(`config.json : la clé « ${cle} » n'existe pas (clés possibles : ${Object.keys(DEFAUTS).join(', ')})`);
    }
  }
  const config = { ...DEFAUTS, ...brut };
  for (const [cle, verif] of Object.entries(verifs)) {
    const resultat = verif(config[cle]);
    if (resultat !== true) {
      throw new ConfigError(`config.json : « ${cle} » doit être ${resultat} (valeur lue : ${JSON.stringify(config[cle])})`);
    }
  }
  return config;
}

/** Lit config.json à la racine du projet. Un fichier absent donne les valeurs par défaut. */
export function chargerConfig(racine) {
  const fichier = path.join(racine, 'config.json');
  let texte;
  try {
    texte = fs.readFileSync(fichier, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return validerConfig({});
    throw new ConfigError(`config.json est illisible : ${e.message}`);
  }
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    throw new ConfigError(`config.json n'est pas un JSON valide (${e.message}). Une virgule oubliée ou en trop est la cause la plus fréquente.`);
  }
  return validerConfig(brut);
}

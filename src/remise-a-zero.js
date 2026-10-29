// `npm run remise-a-zero` : repart d'un cockpit vierge entre deux prises de vue ou deux essais.
//
// Vide les sorties des agents (out/<agent>/) et supprime le journal du jour et des jours précédents (journal/*.jsonl).
// Rien d'autre n'est touché : ni agents/, ni data/, ni config.json, ni les fichiers .gitkeep, ni les journaux du système (journal/*.log).
// Le coût du jour, les budgets de chaque agent et le plafond se relisent dans le journal : ils repartent donc de zéro.
//
// Écrit en Node, sans motif de shell (pas de « rm -rf out/*/ ») : le même geste sur Mac, Windows et Linux, qui ne sort jamais de
// out/ et de journal/, et qui ne suit jamais un lien symbolique (le lien est supprimé, ce qu'il désigne n'est pas touché).

import fs from 'node:fs';
import path from 'node:path';
import { compte, plurielSi } from './utilitaires.js';

const GARDES = new Set(['.gitkeep']);

/**
 * Vide un dossier de sortie : tout part, sauf les .gitkeep. Le dossier disparaît lui-même s'il est vide ensuite.
 * @returns {{supprimes:number, retire:boolean}} le nombre de fichiers (ou de liens) supprimés, et si le dossier a disparu
 */
function viderDossier(dossier) {
  let supprimes = 0;
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isSymbolicLink()) {
      fs.unlinkSync(complet); // le lien, jamais sa cible
      supprimes += 1;
    } else if (entree.isDirectory()) {
      supprimes += viderDossier(complet).supprimes;
    } else if (!GARDES.has(entree.name)) {
      fs.unlinkSync(complet);
      supprimes += 1;
    }
  }
  const retire = fs.readdirSync(dossier).length === 0;
  if (retire) fs.rmdirSync(dossier);
  return { supprimes, retire };
}

/**
 * @param {{racine:string, afficher?:(texte:string)=>void}} p
 * @returns {{dossiers:number, fichiers:number, journaux:number}}
 * @throws {Error} si le dossier ne ressemble pas au cockpit (rien n'est alors supprimé)
 */
export function remiseAZero({ racine, afficher = console.log }) {
  const reel = fs.realpathSync(racine);
  if (!fs.existsSync(path.join(reel, 'package.json')) || !fs.existsSync(path.join(reel, 'agents'))) {
    throw new Error('ce dossier ne ressemble pas au cockpit (il manque package.json ou agents/) : rien n\'est supprimé');
  }

  let dossiers = 0;
  let fichiers = 0;
  const sorties = path.join(reel, 'out');
  if (fs.existsSync(sorties)) {
    for (const entree of fs.readdirSync(sorties, { withFileTypes: true })) {
      const complet = path.join(sorties, entree.name);
      if (entree.isSymbolicLink()) {
        fs.unlinkSync(complet);
        fichiers += 1;
      } else if (entree.isDirectory()) {
        const { supprimes, retire } = viderDossier(complet);
        if (supprimes > 0 || retire) dossiers += 1; // un dossier qui ne contenait que son .gitkeep n'a rien perdu
        fichiers += supprimes;
      }
    }
  }

  let journaux = 0;
  const dossierJournal = path.join(reel, 'journal');
  if (fs.existsSync(dossierJournal)) {
    for (const entree of fs.readdirSync(dossierJournal, { withFileTypes: true })) {
      if (!entree.name.endsWith('.jsonl') || entree.isDirectory()) continue;
      fs.unlinkSync(path.join(dossierJournal, entree.name));
      journaux += 1;
    }
  }

  if (dossiers === 0 && fichiers === 0 && journaux === 0) {
    afficher('Rien à remettre à zéro : out/ et journal/ sont déjà vides.');
  } else {
    afficher(`Remise à zéro : ${compte(dossiers, 'dossier de sortie', 'dossiers de sortie')} ${plurielSi(dossiers, 'vidé')} (${compte(fichiers, 'fichier')} ${plurielSi(fichiers, 'supprimé')}), ${compte(journaux, 'fichier de journal', 'fichiers de journal')} ${plurielSi(journaux, 'supprimé')}.`);
    afficher('Le coût du jour, les budgets des agents et le plafond du jour repartent de zéro : ils se relisent dans le journal.');
    afficher('Rien d\'autre n\'est touché : agents/, data/ et config.json sont intacts.');
  }
  return { dossiers, fichiers, journaux };
}

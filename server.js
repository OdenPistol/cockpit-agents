// Point d'entrée : `npm start`. Vérifie d'abord la version de Node, puis charge le reste.
// (Le reste est chargé après coup, pour qu'un Node trop ancien affiche un message clair
// au lieu d'une erreur de syntaxe.)

import { verifierVersionNode } from './src/version.js';

const probleme = verifierVersionNode(process.versions.node);
if (probleme) {
  console.error(`\n✖ ${probleme}\n`);
  process.exit(1);
}

await import('./src/demarrage.js');

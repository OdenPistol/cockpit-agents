// `npm run essai` : vérifie la version de Node, puis lance l'essai (voir src/essai.js).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifierVersionNode } from '../src/version.js';

const probleme = verifierVersionNode(process.versions.node);
if (probleme) {
  console.error(`\n✖ ${probleme}\n`);
  process.exit(1);
}

const { essai } = await import('../src/essai.js');
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

essai({ racine })
  .then((r) => process.exit(r.code))
  .catch((e) => {
    console.error(`\n✖ Erreur inattendue : ${e.stack ?? e.message}\n`);
    process.exit(1);
  });

// `npm run remise-a-zero` : vérifie la version de Node, puis remet les sorties et le journal à zéro (voir src/remise-a-zero.js).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifierVersionNode } from '../src/version.js';

const probleme = verifierVersionNode(process.versions.node);
if (probleme) {
  console.error(`\n✖ ${probleme}\n`);
  process.exit(1);
}

const { remiseAZero } = await import('../src/remise-a-zero.js');
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  remiseAZero({ racine });
} catch (e) {
  console.error(`\n✖ ${e.message}\n`);
  process.exit(1);
}

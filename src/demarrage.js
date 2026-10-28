// Démarrage du cockpit : serveur web, planificateur, ouverture de l'écran dans le navigateur.
// Lancé par server.js, une fois la version de Node vérifiée.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cockpit } from './cockpit.js';
import { chargerConfig, ConfigError } from './config.js';
import { estAbonnement } from './etat.js';
import { demarrerServeur } from './serveur.js';
import { compte } from './utilitaires.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ouvrirNavigateur(url) {
  const [commande, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const enfant = spawn(commande, args, { stdio: 'ignore', detached: true });
    enfant.on('error', () => {}); // pas de navigateur disponible : l'adresse est affichée de toute façon
    enfant.unref();
  } catch {
    // idem
  }
}

async function main() {
  let config;
  try {
    config = chargerConfig(racine);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`\n✖ ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  const cockpit = new Cockpit({ racine, config });
  const claude = await cockpit.initialiser();

  let serveur;
  try {
    serveur = await demarrerServeur({ cockpit, config, racine });
  } catch (e) {
    console.error(`\n✖ ${e.message}\n`);
    process.exit(1);
  }

  // 127.0.0.1 plutôt que « localhost » : « localhost » peut désigner l'adresse IPv6 (::1), où un autre
  // serveur pourrait écouter sur le même port.
  const url = `http://127.0.0.1:${serveur.port}`;
  const { agents, invalides } = cockpit.agents();
  const virgule = (n) => String(n).replace('.', ',');
  console.log('\nCockpit d\'agents prêt');
  console.log(`  Écran       ${url}`);
  if (claude.ok) {
    const abonnement = estAbonnement(config, claude);
    const etat = claude.connecte === false ? ' · NON CONNECTÉ : tape « claude auth login » dans un terminal' : '';
    console.log(`  Claude Code ${claude.version}${etat}${abonnement ? ' · abonnement : les coûts sont des équivalents API' : ''}`);
  } else {
    console.log(`  ✖ ${claude.erreur}`);
  }
  console.log(`  Agents      ${agents.length}${invalides.length > 0 ? ` (+ ${compte(invalides.length, 'illisible')}, voir l'écran)` : ''}`);
  console.log(`  Plafond     ${config.plafond_jour_eur.toFixed(2).replace('.', ',')} € par jour · taux ${virgule(config.taux_usd_eur)} € pour 1 $`);
  console.log('  Arrêt       Ctrl+C\n');

  cockpit.demarrerPlanificateur();
  if (config.ouvrir_navigateur && !process.argv.includes('--sans-navigateur')) ouvrirNavigateur(url);

  let arret = false;
  const arreter = async () => {
    if (arret) process.exit(1); // deuxième Ctrl+C : on sort tout de suite
    arret = true;
    console.log('\nArrêt en cours…');
    await cockpit.arreter();
    await serveur.fermer();
    process.exit(0);
  };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
}

main().catch((e) => {
  console.error(`\n✖ Erreur inattendue : ${e.stack ?? e.message}\n`);
  process.exit(1);
});

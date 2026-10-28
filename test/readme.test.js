// Le README complet (docs/README-complet.md) s'adresse à quelqu'un qui n'est pas développeur : on vérifie qu'on peut
// le suivre à la lettre. Le README court (README.md) est vérifié contre le code, à la fin du fichier.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chargerAgents, lireAgentMd } from '../src/agent-md.js';
import { chargerConfig } from '../src/config.js';
import { RACINE_REELLE, TUTOIEMENT } from './aide.js';

const readme = fs.readFileSync(path.join(RACINE_REELLE, 'docs', 'README-complet.md'), 'utf8');
// Essai du 28/10/2026 (celui de la vidéo) : 0,495 € pour 8 agents, en équivalent API. Son journal n'est pas publié :
// le chiffre est donc écrit ici, il ne se recalcule pas. La mesure du 21/10 se recalcule, elle, depuis le journal d'exemple.
const ESSAI_28_10 = '0,495';
const blocs = [...readme.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
const commandes = blocs.filter((b) => /^(npm|cd|node|claude)\b/.test(b));
const zsh = spawnSync('zsh', ['-f', '-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';

/**
 * Colle une ligne dans un vrai zsh interactif (comme dans le Terminal d'un Mac), avec `npm` remplacé
 * par une fonction qui n'exécute rien. En interactif, « # » n'est pas un commentaire : une apostrophe
 * dans un commentaire ouvre un guillemet que rien ne ferme (« quote> »).
 */
function collerDansZsh(ligne) {
  const entree = ['npm() { echo "[npm $*]"; }', ligne, 'echo FIN-DE-LA-COMMANDE', ''].join('\n');
  const r = spawnSync('zsh', ['-f', '-i'], { input: entree, encoding: 'utf8', env: { ...process.env, PS1: '', PROMPT: '', RPS1: '', RPROMPT: '' } });
  return `${r.stdout}${r.stderr}`;
}

describe('installation : les commandes se collent telles quelles dans le Terminal', () => {
  it('chaque commande est seule dans son bloc, sur une ligne, sans commentaire', () => {
    assert.ok(commandes.length >= 3, `commandes trouvées : ${commandes.join(' | ')}`);
    for (const c of commandes) {
      assert.ok(!c.includes('\n'), `plusieurs lignes dans un bloc : ${c}`);
      assert.ok(!c.includes('#'), `commentaire dans un bloc : ${c}`);
      assert.ok(!/['"`]/.test(c), `guillemet dans un bloc : ${c}`);
    }
    assert.deepEqual(commandes, ['npm start', 'npm run essai', 'npm test']);
  });

  it('npm install n\'est plus demandé : il n\'y a aucune dépendance', () => {
    assert.ok(!/npm install/.test(readme));
    const paquet = JSON.parse(fs.readFileSync(path.join(RACINE_REELLE, 'package.json'), 'utf8'));
    assert.deepEqual(paquet.dependencies ?? {}, {});
  });

  it('collées dans un zsh interactif, les commandes du README passent, sans « quote> »', { skip: !zsh && 'zsh absent' }, () => {
    for (const c of commandes) {
      const sortie = collerDansZsh(c);
      assert.ok(sortie.includes(`[npm ${c.replace(/^npm /, '')}]`), `${c} : ${sortie}`);
      assert.ok(sortie.includes('FIN-DE-LA-COMMANDE'));
      assert.ok(!/quote>|unmatched|parse error/.test(sortie), `${c} : ${sortie}`);
    }
  });

  it('témoin négatif : l\'ancienne ligne (un commentaire avec une apostrophe) cassait bien dans zsh', { skip: !zsh && 'zsh absent' }, () => {
    const ancienne = 'npm install      # ne télécharge rien : il n\'y a aucune dépendance';
    assert.match(collerDansZsh(ancienne), /quote>|unmatched/);
  });

  it('les gestes d\'un non-développeur sont écrits : récupérer le dossier, cd et espace, glisser, Entrée', () => {
    for (const geste of [/Download ZIP/, /bouton « Code »/, /Tapez `cd` suivi d'une espace/, /glissez le dossier/, /appuyez sur Entrée/]) {
      assert.match(readme, geste);
    }
  });
});

describe('l\'exemple d\'agent du README', () => {
  it('copié tel quel dans agents/mon-agent/agent.md, il est lu sans erreur (les explications sont des commentaires « # »)', () => {
    const bloc = /## Ajouter un agent[\s\S]*?```\n([\s\S]*?)```/.exec(readme)?.[1];
    assert.ok(bloc, 'exemple introuvable');
    const agent = lireAgentMd(bloc, 'mon-agent');
    assert.equal(agent.nom, 'Mon agent');
    assert.equal(agent.planning, '09:00');
    assert.equal(agent.budget_jour_eur, 0.5);
    assert.deepEqual(agent.outils, ['Read', 'Write']);
    assert.equal(agent.max_tours, 8);
  });

  it('témoin négatif : la version avec des explications entre parenthèses était refusée', () => {
    const ancien = '---\nnom: Mon agent\ndescription: x\nplanning: 09:00          (facultatif : l\'heure)\nbudget_jour_eur: 0.50\noutils: Read\nmax_tours: 8\n---\nConsigne';
    assert.throws(() => lireAgentMd(ancien, 'mon-agent'), /« planning » doit être une heure/);
  });
});

describe('le README dit les choses importantes', () => {
  it('dès le début : le cockpit est gratuit, pas Claude Code (abonnement payant ou clé API), avec les deux mesures datées du coût de l\'essai', () => {
    const debut = readme.split('## ')[0];
    assert.match(debut, /gratuit, mais Claude Code ne l'est pas/);
    assert.match(debut, /abonnement Claude payant ou une clé API facturée à l'usage/);
    assert.match(debut, /a coûté 0,495 € le 28\/10\/2026 et 0,577 € le 21\/10\/2026, en équivalent API\./);
    assert.ok(!/environ 0,58/.test(readme), 'plus de chiffre arrondi qui contredirait la mesure du 28/10 (0,495 €)');
    assert.ok(!/pas de clé, pas de compte/i.test(readme), 'plus de phrase qui laisse croire que tout est gratuit');
  });

  it('les coûts annoncés sont ceux du vrai journal fourni en exemple', () => {
    const lignes = fs.readFileSync(path.join(RACINE_REELLE, 'docs', 'exemples-de-sorties', 'journal-2026-10-21.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lignes.length, 8);
    const eur = (n) => n.toFixed(3).replace('.', ',');
    const total = lignes.reduce((t, l) => t + l.cout_eur, 0);
    const parAgent = Object.fromEntries(lignes.map((l) => [l.agent, l.cout_eur]));
    assert.ok(readme.includes(`${eur(total)} € les huit`), `total attendu ${eur(total)} €`);
    assert.ok(readme.includes(`${eur(parAgent.contenu)} € (Contenu)`), 'plus petit passage');
    assert.ok(readme.includes(`${eur(parAgent['boite-mail'])} € (Boîte mail)`), 'plus gros passage');
    assert.ok(readme.includes(`${eur(total)} € le 21/10/2026`), 'la mesure du 21/10 de l\'introduction est le total du journal');
    assert.ok(readme.includes(`${ESSAI_28_10} € les huit`), 'mesure de l\'essai du 28/10');
  });

  it('WebFetch se documente avec un domaine, et Bash avec ses vrais risques', () => {
    assert.match(readme, /WebFetch\(domain:example\.org\)/);
    assert.match(readme, /le cockpit refuse `WebFetch` seul/);
    assert.match(readme, /`WebFetch` seul est refusé/);
    assert.match(readme, /exécuter n'importe quelle commande sur votre Mac sans vous demander/);
    assert.ok(!/élargit ses pouvoirs/.test(readme));
  });

  it('versions : Node 22, claude update, adresse 127.0.0.1', () => {
    assert.match(readme, /Node\.js 22 ou plus/);
    assert.match(readme, /`claude update`/);
    assert.match(readme, /http:\/\/127\.0\.0\.1:4321/);
  });

  it('coût inconnu : l\'écran le dit et le budget compte l\'estimation prudente', () => {
    assert.match(readme, /« coût inconnu »/);
    assert.match(readme, /le budget du jour compte à la place l'estimation prudente/);
  });

  it('lecture : les agents ne lisent que data/, out/ et leur dossier (preuve avec un fichier témoin)', () => {
    assert.match(readme, /ne lisent que `data\/`, `out\/` et leur propre dossier/);
    assert.match(readme, /fichier témoin hors du projet/);
  });

  it('la configuration des agents est dite « isolée » partout, jamais « propre » ; la clé de config.json porte le même nom', () => {
    assert.match(readme, /^## Configuration isolée$/m);
    assert.match(readme, /en \*\*configuration isolée\*\*/);
    assert.match(readme, /`"configuration_isolee": false`/);
    assert.ok(!/configuration propre|configuration_propre/i.test(readme), 'plus de « configuration propre » dans le README');
  });

  it('vouvoiement, sans aucun tutoiement', () => {
    assert.ok(!TUTOIEMENT.test(readme), `tutoiement : « ${TUTOIEMENT.exec(readme)?.[0]} »`);
    assert.match(readme, /\b(vous|votre|vos)\b/i);
    for (const verbe of ['Récupérez', 'Ouvrez', 'Tapez', 'glissez', 'appuyez', 'Créez', 'rechargez']) {
      assert.ok(new RegExp(`\\b${verbe}\\b`).test(readme), verbe);
    }
  });

  it('aucun tiret cadratin ni demi-cadratin', () => {
    assert.ok(!/[\u2013\u2014]/.test(readme));
  });
});

describe('le README court (README.md) : ce qu\'il annonce est ce que le code fait', () => {
  const court = fs.readFileSync(path.join(RACINE_REELLE, 'README.md'), 'utf8');
  const paquet = JSON.parse(fs.readFileSync(path.join(RACINE_REELLE, 'package.json'), 'utf8'));
  const config = chargerConfig(RACINE_REELLE);
  const { agents } = chargerAgents(RACINE_REELLE, config.ordre);
  const journal = fs.readFileSync(path.join(RACINE_REELLE, 'docs', 'exemples-de-sorties', 'journal-2026-10-21.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const virgule = (n) => n.toFixed(2).replace('.', ',');

  it('les cinq parties sont là, les prérequis en dernier', () => {
    const titres = [...court.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(titres, ['Ce que c\'est', 'Le lancer en 2 commandes', 'Ce qu\'il ne fait pas encore', 'Créer un agent', 'Ce qu\'il vous faut']);
  });

  it('les commandes : un clone puis deux scripts de package.json, chacune seule sur une ligne, sans commentaire ni guillemet', () => {
    const commandes = [...court.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
    for (const c of commandes) assert.ok(!/[\n#'"`]/.test(c), `une ligne, sans commentaire : ${c}`);
    const [clone, ...npm] = commandes;
    const depot = /^git clone https:\/\/github\.com\/[A-Za-z0-9-]+\/([a-z-]+)\.git && cd \1$/.exec(clone);
    assert.ok(depot, `clone : ${clone}`);
    assert.equal(depot[1], paquet.name, 'le dossier du « cd » porte le nom du paquet');
    assert.deepEqual(npm, ['npm start', 'npm run essai']);
    assert.ok(paquet.scripts.start && paquet.scripts.essai, 'les deux scripts existent');
    assert.deepEqual(paquet.dependencies ?? {}, {}, 'aucune dépendance : le clone se lance sans npm install');
    assert.ok(!/npm install/.test(court));
  });

  it('l\'adresse, la version de Node et le plafond sont ceux du code et de config.json', () => {
    assert.ok(court.includes(`http://127.0.0.1:${config.port}`));
    assert.match(court, new RegExp(`Node ${/\d+/.exec(paquet.engines.node)[0]} ou plus`));
    assert.ok(court.includes(`${String(config.plafond_jour_eur).replace('.', ',')} € dans \`config.json\``));
  });

  it('les 9 agents annoncés sont les 9 dossiers de agents/', () => {
    assert.equal(agents.length, 9);
    assert.match(court, /La démo a 9 agents d'exemple/);
    for (const a of agents) assert.ok(court.includes(a.nom), `${a.nom} absent du README`);
  });

  it('les heures prévues : quatre agents, entre 07:00 et 08:00', () => {
    const planifies = agents.filter((a) => a.planning);
    assert.equal(planifies.length, 4);
    assert.ok(planifies.every((a) => a.planning >= '07:00' && a.planning <= '08:00'));
    assert.match(court, /quatre agents en ont une, entre 07:00 et 08:00/);
    assert.match(court, /les quatre agents planifiés sont donc signalés « en retard »/);
  });

  it('l\'essai : les deux mesures datées et le refus de Relances prospects viennent de la vidéo, du journal d\'exemple, de l\'agent et de config.json', () => {
    assert.equal(journal.length, 8, 'huit passages : Relances prospects est sauté');
    assert.ok(!journal.some((l) => l.agent === 'prospects'));
    const total21 = journal.reduce((t, l) => t + l.cout_eur, 0).toFixed(3).replace('.', ',');
    assert.ok(court.includes(`Les huit agents lancés ont coûté ${ESSAI_28_10} € en équivalent API à l'essai du 28/10/2026, et ${total21} € à celui du 21/10/2026.`));
    assert.ok(!/environ 0,58/.test(court), 'plus de chiffre arrondi qui contredirait la vidéo (0,49 €)');
    const prospects = agents.find((a) => a.id === 'prospects');
    assert.ok(prospects.budget_jour_eur < config.estimation_defaut_eur);
    assert.ok(court.includes(`son budget de ${virgule(prospects.budget_jour_eur)} € est sous l'estimation d'un passage (${virgule(config.estimation_defaut_eur)} €)`));
  });

  it('les renvois mènent quelque part : le README complet et sa partie « Ajouter un agent », les faux secrets de data/divers/', () => {
    assert.ok(court.includes('(docs/README-complet.md#ajouter-un-agent)'));
    assert.match(readme, /^## Ajouter un agent$/m);
    assert.ok(fs.existsSync(path.join(RACINE_REELLE, 'data', 'divers')));
  });

  it('les prérequis sont en bas, simples ; le coût est dit franchement ; aucun vrai outil branché', () => {
    assert.ok(!/## Il te faut|## Il vous faut/.test(court), 'plus de prérequis en tête');
    const bas = court.slice(court.indexOf('## Ce qu\'il vous faut'));
    assert.ok(bas.includes('- Un ordinateur (Mac, Windows ou Linux), Node 22 ou plus, et Claude Code (abonnement Claude ou clé API).'));
    assert.ok(bas.includes('- Testé sur macOS ; sous Windows et Linux, l\'ouverture du navigateur est prévue (src/demarrage.js) mais pas encore testée.'));
    assert.match(bas, /Le cockpit est gratuit, Claude Code ne l'est pas : chaque passage d'un agent est pris sur votre abonnement ou facturé sur votre clé API\./);
    assert.match(court, /Il n'est branché à aucun vrai outil \(messagerie, facturation, avis\)\./);
  });

  it('l\'ouverture du navigateur annoncée pour les trois systèmes est bien dans src/demarrage.js', () => {
    const source = fs.readFileSync(path.join(RACINE_REELLE, 'src', 'demarrage.js'), 'utf8');
    assert.match(source, /process\.platform === 'darwin'/);
    assert.match(source, /'win32'/);
    assert.match(source, /xdg-open/);
  });

  it('la capture sous le titre existe, et l\'ancienne n\'est référencée nulle part', () => {
    assert.ok(court.split('## ')[0].includes('![Le cockpit d\'agents](docs/captures/cockpit.png)'));
    assert.ok(readme.includes('![Le cockpit d\'agents](captures/cockpit.png)'));
    assert.deepEqual(fs.readdirSync(path.join(RACINE_REELLE, 'docs', 'captures')), ['cockpit.png']);
    assert.ok(!court.includes('en-direct') && !readme.includes('en-direct'));
  });

  it('aucun tiret cadratin ni demi-cadratin, et du vouvoiement', () => {
    assert.ok(!/[\u2013\u2014]/.test(court));
    assert.ok(!TUTOIEMENT.test(court), `tutoiement : « ${TUTOIEMENT.exec(court)?.[0]} »`);
    assert.match(court, /\b(vous|votre|vos)\b/i);
  });
});

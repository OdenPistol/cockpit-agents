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

  it('les six parties sont là (la nouvelle version après le lancement), les prérequis en dernier', () => {
    const titres = [...court.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(titres, ['Ce que c\'est', 'Le lancer en 2 commandes', 'Nouvelle version : l\'agent Juge', 'Ce qu\'il ne fait pas encore', 'Créer un agent', 'Ce qu\'il vous faut']);
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

  it('les 10 agents annoncés sont les 10 dossiers de agents/', () => {
    assert.equal(agents.length, 10);
    assert.match(court, /La démo a 10 agents d'exemple/);
    for (const a of agents) assert.ok(court.includes(a.nom), `${a.nom} absent du README`);
  });

  it('les heures prévues : quatre agents, entre 07:00 et 08:00 (le Juge n\'en a pas : il ne part qu\'au clic)', () => {
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

describe('la nouvelle version : le Juge est annoncé tel qu\'il est livré', () => {
  const lire = (...p) => fs.readFileSync(path.join(RACINE_REELLE, ...p), 'utf8');
  const court = lire('README.md');
  const paquet = JSON.parse(lire('package.json'));
  const verrou = JSON.parse(lire('package-lock.json'));
  const config = chargerConfig(RACINE_REELLE);
  const { agents } = chargerAgents(RACINE_REELLE, config.ordre);
  const juge = agents.find((a) => a.id === 'juge');
  const sectionJuge = court.slice(court.indexOf('## Nouvelle version : l\'agent Juge'), court.indexOf('## Ce qu\'il ne fait pas encore'));
  const changelog = lire('CHANGELOG.md');
  const dod = lire('docs', 'ecrire-une-dod.md');
  const ecran = lire('public', 'app.js');

  it('la version du paquet, du verrou, du README et du CHANGELOG est la même : 1.1.0', () => {
    assert.equal(paquet.version, '1.1.0');
    assert.equal(verrou.version, '1.1.0');
    assert.equal(verrou.packages[''].version, '1.1.0');
    assert.match(sectionJuge, /Version 1\.1\.0 \(voir le \[CHANGELOG\]\(CHANGELOG\.md\)\)/);
  });

  it('le CHANGELOG : l\'entrée 1.1.0 « date à remplir à la publication », puis la 1.0.0 datée du 28/10/2026', () => {
    // À la publication : remplacer « date à remplir à la publication » par la date, dans CHANGELOG.md et dans l'assertion ci-dessous,
    // dans le même commit (sinon ce test échoue, exprès : il empêche de publier avec le texte provisoire).

    assert.match(changelog, /^# Changelog\n/);
    const titres = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(titres, ['1.1.0 (date à remplir à la publication) : l\'agent Juge', '1.0.0 (28/10/2026) : le cockpit d\'agents']);
    assert.match(changelog, /Le coût du Juge compte dans son budget et dans le plafond du jour/);
    assert.match(changelog, /« Vérifié par le Juge : accepté » ou « Rejeté : 1 correction »/);
    assert.match(changelog, /le nombre de critères respectés, par exemple 4\/5, puis les critères, les corrections et leurs preuves/);
    assert.ok(!/score/i.test(changelog), 'pas de « score »');
    for (const nouveau of ['`PORT=4322 npm start`', '`npm run remise-a-zero`', '`.gitleaksignore`', '`--strict-mcp-config`']) assert.ok(changelog.includes(nouveau), nouveau);
    assert.match(changelog, /F-2026-0079/);
  });

  it('la section « Nouvelle version » commence par ce que fait le Juge, en une phrase, avant le numéro de version et le principe en cinq lignes', () => {
    assert.ok(sectionJuge.startsWith('## Nouvelle version : l\'agent Juge\n\nUn second agent vérifie le travail du premier avant que vous vous en serviez, avec des critères écrits d\'avance. Version 1.1.0 (voir le [CHANGELOG](CHANGELOG.md)). Le principe en cinq lignes :\n'));
    assert.ok(sectionJuge.includes('écrits **avant** le travail'), 'pas de capitales : « avant » en gras');
    assert.ok(!/\bAVANT\b/.test(court), 'aucun mot en capitales dans le README');
  });

  it('« Pour l\'essayer » : d\'abord attendre la fin du passage de Factures ; la variabilité est dite avec les chiffres mesurés, puis la remise à zéro', () => {
    assert.ok(sectionJuge.includes('cliquez sur « Lancer » à droite de Factures, attendez la fin de son passage, puis cliquez sur « Lancer le Juge » sous son nom.'));
    // mesure du 29/10/2026 : Factures a recopié l'erreur à chacun des 5 passages où le fichier de données n'avait pas été corrigé à la main ;
    // le Juge en a jugé quatre et rejeté quatre. Le seul accord du premier coup du journal suit le passage où le CSV avait été corrigé à la main.
    assert.ok(sectionJuge.includes('Le plus souvent, le Juge la relève et rejette la sortie (4 rejets sur 4 jugements à la mesure du 29/10/2026). Il peut arriver que Factures repère l\'erreur lui-même : le Juge accepte alors du premier coup. Remettez à zéro (`npm run remise-a-zero`) et relancez Factures.'));
    assert.ok(sectionJuge.includes('puis de nouveau sur « Lancer le Juge » : il accepte (trois fois sur trois à la même mesure).'));
  });

  it('le coût d\'un cycle, le nombre de passages du Juge par jour, et ce que la remise à zéro efface, sont dits', () => {
    assert.ok(sectionJuge.includes('Un cycle complet (rejet, relance, accord) coûte environ 0,20 € en équivalent API.'));
    assert.ok(sectionJuge.includes('cela fait environ 8 passages du Juge par jour'));
    assert.ok(sectionJuge.includes('`npm run remise-a-zero` vide `out/` et `journal/` (les sorties et l\'historique des agents, rien d\'autre) et efface donc aussi le compteur du plafond du jour'));
    // 0,40 € de budget, environ 0,05 € le passage : 8 passages ; un cycle = 2 passages de Factures et 2 du Juge, environ 0,05 € chacun
    assert.ok(juge.budget_jour_eur / 0.05 === 8);
  });

  it('le port : PORT=4322 npm start dans les deux README, sans toucher à config.json ; la version de Claude Code testée', () => {
    assert.ok(court.includes('Le port 4321 est déjà pris, par une autre copie du cockpit par exemple ? Lancez `PORT=4322 npm start` : aucun fichier n\'est modifié, l\'autre copie n\'est pas touchée, et l\'adresse affichée au démarrage est la bonne (c\'est elle qu\'il faut ouvrir).'));
    assert.ok(readme.includes('**Le port 4321 est déjà pris**'));
    assert.ok(readme.includes('`PORT=4322 npm start`'));
    assert.ok(readme.includes('La variable `PORT` l\'emporte sur le réglage `port` de `config.json`, sans modifier aucun fichier et sans toucher à l\'autre copie'));
    assert.ok(court.includes('- Testé avec Claude Code 2.1.308 (29/10/2026). Si votre version est plus ancienne, tapez `claude update`.'));
    assert.ok(!/\b(kill|tuez|arrêtez l'autre)\b/i.test(court + readme), 'on ne dit jamais d\'arrêter l\'autre copie');
  });

  it('la remise à zéro est documentée dans le README complet, avec ce qu\'elle touche et ce qu\'elle ne touche pas', () => {
    assert.match(readme, /`npm run remise-a-zero` vide `out\/<agent>\/` et supprime `journal\/\*\.jsonl`/);
    assert.match(readme, /Rien d'autre n'est touché : ni `agents\/`, ni `data\/`, ni `config\.json`/);
    assert.match(readme, /le coût du jour, les budgets des agents et le plafond se relisent dans le journal|les budgets des agents et le plafond se relisent dans le journal/);
    assert.match(readme, /Un cycle complet \(rejet, relance, accord\) coûte environ 0,20 € en équivalent API\./);
    assert.match(readme, /cela fait environ 8 passages par jour/);
  });

  it('la section « Nouvelle version » : le principe en cinq lignes, comment l\'essayer, avec les mots exacts de l\'écran', () => {
    const puces = sectionJuge.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(puces.length, 5, 'le principe tient en cinq lignes');
    for (const mot of ['Lancer le Juge', 'Relancer avec les corrections', 'Vérifié par le Juge : accepté', 'Rejeté : 1 correction', 'F-2026-0079', 'ACCEPTÉ ou REJETÉ']) {
      assert.ok(sectionJuge.includes(mot), `« ${mot} » absent de la section`);
    }
    for (const bouton of ['Lancer le Juge', 'Relancer avec les corrections']) assert.ok(ecran.includes(`'${bouton}'`), `le bouton « ${bouton} » existe à l'écran`);
    assert.ok(sectionJuge.includes(`${String(juge.budget_jour_eur.toFixed(2)).replace('.', ',')} €`), 'le budget annoncé est celui de agents/juge/agent.md');
    assert.ok(sectionJuge.includes('outils Read et Write'));
  });

  it('les renvois mènent quelque part : le CHANGELOG et la page « comment écrire une DoD », depuis les deux README', () => {
    assert.ok(sectionJuge.includes('(docs/ecrire-une-dod.md)'));
    assert.ok(readme.includes('(ecrire-une-dod.md)'));
    assert.ok(fs.existsSync(path.join(RACINE_REELLE, 'CHANGELOG.md')));
    assert.ok(fs.existsSync(path.join(RACINE_REELLE, 'docs', 'ecrire-une-dod.md')));
  });

  it('la page « comment écrire une DoD » commence par « Par où commencer », donne un exemple hors factures (Veille), et dit que 4/5 n\'est pas une note', () => {
    assert.match(dod, /^## Par où commencer\n\nPrenez la consigne de votre agent et demandez-vous : si on me rendait ce travail, qu'est-ce qui me le ferait refuser \? Notez chaque réponse, gardez les trois à cinq erreurs qui coûteraient le plus cher, puis rendez chacune vérifiable avec les règles ci-dessous\.$/m);
    assert.ok(dod.indexOf('## Par où commencer') < dod.indexOf('## Les règles d\'un bon critère'), '« les règles ci-dessous » viennent après');
    assert.match(dod, /^\| Les infos sont récentes\. \| Chaque information cite sa source \(lien\) et une date de moins de 7 jours\. \|$/m);
    assert.match(dod, /Le verdict affiche combien de critères sont respectés \(par exemple 4\/5\), mais ce n'est pas une note : un seul écart suffit pour que le verdict soit REJETÉ\./);
    assert.ok(!/score/i.test(dod), 'pas de « score »');
  });

  it('la page « comment écrire une DoD » tient en une page, et son exemple est la DoD livrée de Factures, mot pour mot', () => {
    assert.ok(dod.split('\n').length <= 70, `${dod.split('\n').length} lignes`);
    assert.match(dod, /s'écrit \*\*avant\*\* le travail/);
    const exemple = /```\n([\s\S]*?)```/.exec(dod)?.[1];
    assert.equal(exemple, lire('agents', 'factures', 'dod.md'));
    assert.match(dod, /Trois à cinq critères, dix au plus, un par numéro, chacun de 600 caractères au plus/);
  });

  it('le README complet : le Juge dans la table des 10 agents, ses états tels que l\'écran les écrit, ses limites dites', () => {
    assert.match(readme, /^## Les 10 agents$/m);
    assert.match(readme, /^\| Juge \|.*`out\/juge\/` \|$/m);
    for (const texte of [
      '5 critères écrits · rien à vérifier encore', 'À vérifier par le Juge', 'Le Juge vérifie…', 'Vérifié par le Juge : accepté', 'Rejeté : 1 correction',
      'Verdict du Juge illisible', 'Le Juge n\'a pas pu vérifier', 'Lancer le Juge', 'Relancer avec les corrections', 'Relancer le Juge',
    ]) assert.ok(readme.includes(texte), `« ${texte} » absent du README complet`);
    assert.match(readme, /^## Le Juge et la definition of done$/m);
    assert.match(readme, /Le Juge est un modèle/);
    assert.match(readme, /Rien d'automatique/);
    assert.match(readme, /`npm run essai` ne le lance pas/);
    assert.match(readme, /dix corrections, 800 caractères chacune/);
    assert.match(readme, /out\/juge\/verdict-<agent>-AAAA-MM-JJ-N\.md/);
  });

  it('le README complet renvoie aux deux verdicts réels livrés en exemple, et donne le coût mesuré d\'un passage du Juge', () => {
    for (const nom of ['verdict-factures-2026-10-29-1.md', 'verdict-factures-2026-10-29-2.md']) {
      assert.ok(readme.includes(`\`${nom}\``), nom);
      assert.ok(fs.existsSync(path.join(RACINE_REELLE, 'docs', 'exemples-de-sorties', nom)), nom);
    }
    // mesure du 29/10/2026, neuf passages réels : le journal n'est pas publié, le chiffre est écrit ici comme celui de l'essai du 28/10
    assert.match(readme, /Le Juge, mesuré le 29\/10\/2026 : de 0,042 € à 0,055 € par passage \(neuf passages, de 10 à 30 secondes, 4 tours chacun\)/);
  });

  it('l\'essai réel du Juge est dit tel qu\'il s\'est passé (cinq sorties sur cinq recopient l\'erreur, quatre rejets, trois accords), avec sa réserve', () => {
    assert.match(readme, /Mesure du 29\/10\/2026 \(Claude Code 2\.1\.308, modèle sonnet\) : sur cinq passages de Factures avec l'erreur plantée, Factures a recopié l'erreur cinq fois ; le Juge a rejeté les quatre sorties qu'il a jugées, pour le même critère, et il a accepté les trois sorties refaites avec les corrections\./);
    assert.match(readme, /Essayé en réel le 29\/10\/2026 : une sortie qui contenait une fausse instruction officielle/);
    assert.match(readme, /L'autre voie a aussi été essayée en réel \(corriger le fichier de données avant de relancer Factures\) : Factures a écrit 1 560,00 € et un total de 14 220,00 €, et le Juge a accepté du premier coup \(le journal ne garde pas trace de la correction des données : ce passage y apparaît comme un passage ordinaire de Factures\)\./);
    assert.match(readme, /Un modèle peut varier d'un essai à l'autre : c'est une mesure, pas une garantie\./);
    assert.match(readme, /Il juge le fichier que l'agent a écrit en dernier/);
  });
});

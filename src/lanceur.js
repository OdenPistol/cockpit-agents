// Lancement d'un agent : exécute réellement `claude -p` en mode headless et lit son flux stream-json.
//
// Ce que fait la commande construite ici (options vérifiées sur Claude Code 2.1.306) :
//   -p                              mode non interactif, la consigne arrive par l'entrée standard, telle quelle
//   --output-format stream-json --verbose   un événement JSON par ligne, dont le « result » final avec le coût
//   --max-turns N                   nombre maximal de tours, pris dans agent.md (option absente de `claude --help`
//                                   mais acceptée et documentée)
//   --tools …                       n'expose à Claude QUE les outils de agent.md (pas de Bash par défaut)
//   --allowedTools …                autorise sans demander ce qui n'est pas déjà permis : l'écriture, limitée à
//                                   out/<agent>/ ; jamais Read, Glob ou Grep nus (voir plus bas)
//   --permission-mode dontAsk       tout ce qui n'est pas autorisé est refusé, sans question ; les lectures
//                                   dans le dossier de travail et les dossiers --add-dir restent permises
//   --add-dir data, out             lecture des données et des sorties des autres agents (rien d'autre),
//                                   plus les dossiers du projet que agent.md demande, par exemple Read(agents/**)
//   --no-session-persistence        n'écrit pas de session dans l'historique de l'utilisateur
// Configuration isolée (réglage « configuration_isolee » de config.json) :
//   --setting-sources project       ignore les réglages personnels de l'utilisateur
//   --settings '{"claudeMdExcludes":["**/CLAUDE.md"]}'   ignore aussi les CLAUDE.md des dossiers parents
//   CLAUDE_CODE_DISABLE_AUTO_MEMORY=1   pas de mémoire automatique
//   --strict-mcp-config             aucun serveur MCP ni connecteur de compte (Gmail, Drive…)
//   --disable-slash-commands        aucune skill ni commande personnelle

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nomOutil } from './agent-md.js';
import { ceQuIlAFait } from './bilan.js';
import { usdVersEur } from './cout.js';
import { FormateurFlux } from './flux.js';
import { ajouterEntree } from './journal.js';
import { arrondir, compte, court, duree, eur, isoLocal, minusculeInitiale, nettoyerChemins } from './utilitaires.js';

const OUTILS_ECRITURE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Les étapes d'un passage gardées dans le journal, pour que l'écran les remontre au repos (les dernières seulement).
const ETAPES_GARDEES = 80;
const OUTILS_LECTURE = new Set(['Read', 'Glob', 'Grep']);

/** Échappe les caractères spéciaux des motifs de chemin de Claude Code (syntaxe gitignore). */
export function echapperMotif(chemin) {
  return chemin.replace(/([\\[\]*?])/g, '\\$1');
}

/**
 * Règle de lecture écrite depuis la racine du projet, par exemple « Read(agents/**) » : renvoie le dossier réel à
 * ouvrir en lecture (<projet>/agents), ou null s'il sort du projet, s'il n'existe pas, s'il est caché ou s'il est le projet entier.
 * Renvoie undefined pour une règle qui n'est pas relative (« Read(//usr/share/doc/**) ») : elle passe telle quelle.
 */
export function dossierEnLecture(outil, reel) {
  const chemin = /^[A-Za-z]+\((.*)\)$/.exec(outil)?.[1];
  if (chemin === undefined || chemin.startsWith('/') || chemin.startsWith('~')) return undefined;
  try {
    const dossier = fs.realpathSync(path.resolve(reel, chemin.replace(/\/\*\*$/, '')));
    if (!dossier.startsWith(reel + path.sep) || !fs.statSync(dossier).isDirectory()) return null;
    // jamais un dossier caché (.git, .env…) : ce qu'il contient n'est pas fait pour un agent
    return path.relative(reel, dossier).split(path.sep).some((s) => s.startsWith('.')) ? null : dossier;
  } catch {
    return null;
  }
}

/**
 * Construit la commande à lancer pour un agent. Fonction pure (à part la résolution des liens
 * symboliques du dossier du projet) : facile à tester sans lancer Claude Code.
 * @returns {{commande:string, args:string[], env:object, cwd:string, sortie:string, racineReelle:string}}
 */
export function construireCommande(agent, config, racine) {
  const reel = fs.realpathSync(racine);
  const dossierAgent = path.join(reel, 'agents', agent.id);
  const dossierData = path.join(reel, 'data');
  const dossierOut = path.join(reel, 'out');
  const sortie = path.join(dossierOut, agent.id);

  const noms = [...new Set(agent.outils.map(nomOutil))];
  const autorisations = [];
  const dossiersLus = [];
  let ecritureLimitee = false;
  for (const outil of agent.outils) {
    if (OUTILS_LECTURE.has(nomOutil(outil)) && outil === nomOutil(outil)) {
      // Lecture : rien à autoriser. Un « Read » nu dans --allowedTools laisserait l'agent lire tout le disque.
      // En mode dontAsk, Claude Code laisse déjà lire le dossier de travail (agents/<id>/) et les dossiers
      // --add-dir (data/ et out/), et refuse tout le reste (vérifié avec un fichier témoin hors du projet).
      // Une règle avec chemin, par exemple Read(//usr/share/doc/**), est en revanche conservée telle quelle.
      continue;
    }
    if (OUTILS_LECTURE.has(nomOutil(outil))) {
      const dossier = dossierEnLecture(outil, reel);
      if (dossier !== undefined) {
        // Un dossier du projet en plus de data/ et out/, écrit depuis sa racine : « Read(agents/**) ». Claude Code
        // n'applique pas une règle relative en mode dontAsk (mesuré : lecture refusée) ; le dossier passe donc par
        // --add-dir, en lecture seule (l'écriture reste limitée à out/<agent>/). Hors du projet : ignoré.
        if (dossier && ![dossierData, dossierOut, ...dossiersLus].includes(dossier)) dossiersLus.push(dossier);
        continue;
      }
    }
    if (OUTILS_ECRITURE.has(nomOutil(outil))) {
      // Claude Code ne consulte les règles de chemin que sous la forme Edit(…) : elle couvre
      // Write, Edit, MultiEdit et NotebookEdit. « // » + chemin absolu = chemin depuis la racine du disque.
      if (!ecritureLimitee) {
        autorisations.push(`Edit(/${echapperMotif(sortie)}/**)`);
        ecritureLimitee = true;
      }
    } else {
      autorisations.push(outil);
    }
  }

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(agent.max_tours),
    '--permission-mode', 'dontAsk',
    '--tools', noms.join(','),
    ...(autorisations.length > 0 ? ['--allowedTools', autorisations.join(',')] : []),
    '--add-dir', dossierData,
    '--add-dir', dossierOut,
    ...dossiersLus.flatMap((d) => ['--add-dir', d]),
    '--no-session-persistence',
  ];
  if (config.modele) args.push('--model', config.modele);

  const env = { ...process.env };
  if (config.configuration_isolee) {
    args.push(
      '--setting-sources', 'project',
      '--settings', JSON.stringify({ claudeMdExcludes: ['**/CLAUDE.md'] }),
      '--strict-mcp-config',
      '--disable-slash-commands',
    );
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  }

  return { commande: config.commande_claude, args, env, cwd: dossierAgent, sortie, racineReelle: reel };
}

/** Liste récursive des fichiers d'un dossier, avec leur date de modification. */
function listerFichiers(dossier, racine, limite = 500) {
  const fichiers = new Map();
  const parcourir = (d) => {
    let entrees;
    try {
      entrees = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      if (fichiers.size >= limite) return;
      const complet = path.join(d, e.name);
      if (e.isDirectory()) parcourir(complet);
      else if (e.isFile() && e.name !== '.gitkeep') {
        try {
          fichiers.set(path.relative(racine, complet), fs.statSync(complet).mtimeMs);
        } catch {
          // fichier disparu entre-temps
        }
      }
    }
  };
  parcourir(dossier);
  return fichiers;
}

/** Message d'erreur lisible pour un événement « result » qui n'est pas un succès. */
function erreurDuResultat(result, agent) {
  if (result.subtype === 'error_max_turns') {
    return `Nombre maximal de tours atteint (${agent.max_tours}). Augmente max_tours dans agent.md ou simplifie la consigne.`;
  }
  const texte = typeof result.result === 'string' && result.result.trim() !== ''
    ? result.result
    : Array.isArray(result.errors) ? result.errors.join(' ; ') : '';
  return court(texte || `Claude Code a terminé en erreur (${result.subtype ?? 'sans détail'}).`, 300);
}

/**
 * Lance un agent et renvoie `{ promesse, arreter }`.
 * La promesse se résout toujours (jamais de rejet) avec la ligne de journal, déjà écrite dans journal/.
 *
 * @param {object} p
 * @param {object} p.agent agent lu par lireAgentMd
 * @param {object} p.config configuration validée
 * @param {string} p.racine dossier du projet
 * @param {'manuel'|'planning'|'essai'} [p.declencheur]
 * @param {(ligne:{ts:string, niveau:string, type?:string, texte:string}) => void} [p.surLigne] journal en direct
 * @param {() => Date} [p.maintenant] horloge (remplaçable dans les tests)
 * @param {number|null} [p.estimationEur] estimation prudente du coût, comptée dans le budget si le coût reste inconnu
 */
export function executer({ agent, config, racine, declencheur = 'manuel', surLigne = () => {}, maintenant = () => new Date(), estimationEur = null }) {
  const home = os.homedir();
  const cmd = construireCommande(agent, config, racine);
  const reel = cmd.racineReelle;
  const propre = (texte) => nettoyerChemins(texte, { racine: reel, home });
  const etapes = [];
  const emettre = (l) => {
    const complete = { ts: isoLocal(maintenant()), ...l };
    etapes.push({ ts: complete.ts, niveau: complete.niveau, ...(complete.type ? { type: complete.type } : {}), texte: court(complete.texte, 300) });
    surLigne(complete);
  };

  fs.mkdirSync(cmd.sortie, { recursive: true });
  fs.mkdirSync(path.join(reel, 'data'), { recursive: true });
  const avant = listerFichiers(cmd.sortie, reel);
  const debut = maintenant();
  const formateur = new FormateurFlux({ racine: reel, home, cwd: cmd.cwd });

  let enfant = null;
  let interrompu = null;
  let minuteur = null;
  let tueur = null;

  const promesse = new Promise((resolve) => {
    let tampon = '';
    let stderr = '';
    let erreurLancement = null;
    let termine = false;

    const traiterLigne = (brut) => {
      const ligne = brut.trim();
      if (ligne === '') return;
      let evenement;
      try {
        evenement = JSON.parse(ligne);
      } catch {
        return; // ligne qui n'est pas du JSON : ignorée, jamais affichée brute
      }
      for (const l of formateur.traiter(evenement)) emettre(l);
    };

    const finir = (code, signal) => {
      if (termine) return;
      termine = true;
      clearTimeout(minuteur);
      clearTimeout(tueur);
      if (tampon.trim() !== '') traiterLigne(tampon);

      const fin = maintenant();
      const result = formateur.resultat;
      const init = formateur.init;
      let statut;
      let erreur = null;
      let coutUsd = null;
      let tours = null;
      let dureeMs = null;

      if (result) {
        coutUsd = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null;
        tours = typeof result.num_turns === 'number' ? result.num_turns : null;
        dureeMs = typeof result.duration_ms === 'number' ? result.duration_ms : null;
        if (result.is_error !== true && result.subtype === 'success') {
          statut = 'reussi';
        } else {
          statut = 'echec';
          erreur = erreurDuResultat(result, agent);
        }
      } else {
        statut = 'echec';
        dureeMs = fin - debut;
        if (erreurLancement) {
          coutUsd = 0; // rien n'a tourné, rien n'a été dépensé
          erreur = erreurLancement.code === 'ENOENT'
            ? `Claude Code est introuvable (commande « ${cmd.commande} »). Installe-le, puis relance le cockpit.`
            : `Impossible de lancer Claude Code : ${erreurLancement.message}`;
        } else if (interrompu === 'delai') {
          erreur = `Délai maximal dépassé (${config.delai_max_s} s) : passage interrompu.`;
        } else if (interrompu) {
          erreur = interrompu;
        } else {
          erreur = `Claude Code s'est arrêté sans résultat (${code !== null ? `code ${code}` : `signal ${signal}`}). ${court(stderr, 200)}`.trim();
        }
      }

      // Coût inconnu : Claude Code n'a pas renvoyé de « result ». Le budget compte alors l'estimation prudente.
      const coutInconnu = coutUsd === null;
      const coutEstime = coutInconnu ? arrondir(estimationEur ?? config.estimation_defaut_eur, 6) : null;

      const apres = listerFichiers(cmd.sortie, reel);
      const ecrits = [...apres.entries()]
        .filter(([rel, mtime]) => avant.get(rel) !== mtime)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      const resultat = ecrits.length > 0 ? ecrits.at(-1)[0].split(path.sep).join('/') : null;

      // Ce qu'a fait l'agent, en une ligne tirée de ce qu'il a écrit (voir bilan.js) : l'écran l'affiche sous son nom.
      let texteFichier = null;
      if (statut === 'reussi' && resultat) {
        try {
          texteFichier = fs.readFileSync(path.join(reel, resultat), 'utf8');
        } catch {
          // fichier disparu entre-temps : on se rabat sur le message final
        }
      }
      const bilan = ceQuIlAFait({ statut, texteFichier, messageFinal: typeof result?.result === 'string' ? result.result : null });

      const phrase = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);
      const erreurPropre = erreur === null ? null : propre(erreur);
      const ligneFin = statut === 'reussi'
        ? { niveau: 'fin', texte: `Terminé en ${duree(dureeMs)} · ${compte(tours ?? '?', 'tour')} · ${eur(coutUsd === null ? null : usdVersEur(coutUsd, config.taux_usd_eur), 3)}` }
        : {
          niveau: 'erreur',
          texte: `Échec : ${phrase(minusculeInitiale(erreurPropre))}${coutInconnu ? ` Coût inconnu : l'estimation prudente (${eur(coutEstime)}) est comptée dans le budget du jour.` : ''}`,
        };

      const entree = {
        agent: agent.id,
        agent_nom: agent.nom,
        declencheur,
        debut: isoLocal(debut),
        fin: isoLocal(fin),
        statut,
        cout_usd: coutUsd,
        cout_eur: coutUsd === null ? null : usdVersEur(coutUsd, config.taux_usd_eur),
        cout_estime_eur: coutEstime,
        taux_usd_eur: config.taux_usd_eur,
        duree_ms: dureeMs,
        tours,
        resultat,
        fichiers: ecrits.map(([rel]) => rel.split(path.sep).join('/')),
        erreur: erreurPropre,
        modele: init?.model ?? null,
        source_cle: init?.apiKeySource ?? null,
        version_claude: init?.claude_code_version ?? null,
        bilan: bilan === null ? null : propre(bilan),
        etapes: [...etapes, { ts: isoLocal(fin), ...ligneFin }].slice(-ETAPES_GARDEES),
      };

      try {
        ajouterEntree(path.join(reel, 'journal'), entree);
      } catch (e) {
        emettre({ niveau: 'erreur', texte: `Le journal n'a pas pu être écrit : ${propre(e.message)}` });
      }

      emettre(ligneFin);
      resolve(entree);
    };

    try {
      enfant = spawn(cmd.commande, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      erreurLancement = e;
      finir(null, null);
      return;
    }

    enfant.on('error', (e) => {
      erreurLancement = e;
      finir(null, null);
    });
    enfant.stdout.on('data', (morceau) => {
      tampon += morceau.toString('utf8');
      let i = tampon.indexOf('\n');
      while (i >= 0) {
        traiterLigne(tampon.slice(0, i));
        tampon = tampon.slice(i + 1);
        i = tampon.indexOf('\n');
      }
    });
    enfant.stderr.on('data', (morceau) => {
      stderr = (stderr + morceau.toString('utf8')).slice(-4000);
    });
    enfant.on('close', (code, signal) => finir(code, signal));

    // La consigne est transmise telle quelle, par l'entrée standard.
    enfant.stdin.on('error', () => {});
    enfant.stdin.end(agent.prompt);

    minuteur = setTimeout(() => {
      interrompu = 'delai';
      enfant.kill('SIGTERM');
      tueur = setTimeout(() => enfant.kill('SIGKILL'), 5000);
      tueur.unref?.();
    }, config.delai_max_s * 1000);
    minuteur.unref?.();
  });

  const arreter = (raison) => {
    if (!enfant || enfant.exitCode !== null) return;
    interrompu = raison;
    enfant.kill('SIGTERM');
    tueur = setTimeout(() => enfant.kill('SIGKILL'), 5000);
    tueur.unref?.();
  };

  return { promesse, arreter };
}

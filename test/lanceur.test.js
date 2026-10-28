import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { lireAgentMd } from '../src/agent-md.js';
import { lireJour } from '../src/journal.js';
import { construireCommande, dossierEnLecture, echapperMotif, executer } from '../src/lanceur.js';
import { jourLocal } from '../src/utilitaires.js';
import { agentMd, configTest, creerProjet, nettoyer } from './aide.js';

/** Exécute `fn` avec des variables d'environnement temporaires. */
async function avecEnv(variables, fn) {
  const avant = {};
  for (const [cle, valeur] of Object.entries(variables)) {
    avant[cle] = process.env[cle];
    process.env[cle] = valeur;
  }
  try {
    return await fn();
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle]; else process.env[cle] = valeur;
    }
  }
}

const valeurApres = (args, drapeau) => args[args.indexOf(drapeau) + 1];

describe('construireCommande : ce qui est réellement passé à claude', () => {
  it('lance claude -p en stream-json, avec les tours et les outils de agent.md, dans le dossier de l\'agent', () => {
    const racine = creerProjet({ alpha: agentMd({ tours: 7, outils: 'Read, Write, Glob, Grep' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      assert.equal(c.cwd, path.join(racine, 'agents', 'alpha'));
      assert.equal(c.args[0], '-p');
      assert.equal(valeurApres(c.args, '--output-format'), 'stream-json');
      assert.ok(c.args.includes('--verbose'), 'stream-json exige --verbose avec -p');
      assert.equal(valeurApres(c.args, '--max-turns'), '7');
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Write,Glob,Grep');
      assert.equal(valeurApres(c.args, '--permission-mode'), 'dontAsk');
      assert.ok(c.args.includes('--no-session-persistence'));
      assert.equal(valeurApres(c.args, '--model'), 'sonnet');
    } finally {
      nettoyer(racine);
    }
  });

  it('aucun Bash par défaut, et l\'écriture est limitée au dossier de sortie de l\'agent', () => {
    const racine = creerProjet({ alpha: agentMd() });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      assert.ok(!valeurApres(c.args, '--tools').includes('Bash'));
      assert.ok(!valeurApres(c.args, '--allowedTools').includes('Bash'));
      const autorisations = valeurApres(c.args, '--allowedTools').split(',');
      assert.ok(autorisations.includes(`Edit(/${path.join(racine, 'out', 'alpha')}/**)`), autorisations.join(' | '));
      assert.ok(!autorisations.includes('Write'), 'Write nu autoriserait l\'écriture partout');
      assert.deepEqual(c.args.filter((a, i) => c.args[i - 1] === '--add-dir'), [path.join(racine, 'data'), path.join(racine, 'out')]);
      for (const interdit of ['--dangerously-skip-permissions', '--bare', 'bypassPermissions']) {
        assert.ok(!c.args.includes(interdit), interdit);
      }
    } finally {
      nettoyer(racine);
    }
  });

  it('configuration isolée (par défaut) : réglages personnels, CLAUDE.md, mémoire, MCP et skills écartés', () => {
    const racine = creerProjet({ alpha: agentMd() });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest({ configuration_isolee: true }), racine);
      assert.equal(valeurApres(c.args, '--setting-sources'), 'project');
      assert.deepEqual(JSON.parse(valeurApres(c.args, '--settings')), { claudeMdExcludes: ['**/CLAUDE.md'] });
      assert.ok(c.args.includes('--strict-mcp-config'));
      assert.ok(c.args.includes('--disable-slash-commands'));
      assert.equal(c.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    } finally {
      nettoyer(racine);
    }
  });

  it('configuration complète (réglage à false) : seules les protections de l\'agent restent', () => {
    const racine = creerProjet({ alpha: agentMd() });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest({ configuration_isolee: false }), racine);
      for (const drapeau of ['--setting-sources', '--settings', '--strict-mcp-config', '--disable-slash-commands']) {
        assert.ok(!c.args.includes(drapeau), drapeau);
      }
      assert.notEqual(c.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Write,Glob,Grep', 'les outils de agent.md s\'appliquent toujours');
      assert.equal(valeurApres(c.args, '--permission-mode'), 'dontAsk');
    } finally {
      nettoyer(racine);
    }
  });

  it('lecture : aucun outil de lecture n\'est autorisé sans restriction de chemin (sinon l\'agent lit tout le disque)', () => {
    const racine = creerProjet({ alpha: agentMd({ outils: 'Read, Glob, Grep, Write' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      const autorisations = valeurApres(c.args, '--allowedTools').split(',');
      for (const nu of ['Read', 'Glob', 'Grep']) {
        assert.ok(!autorisations.includes(nu), `« ${nu} » nu dans --allowedTools autorise la lecture de tout le disque : ${autorisations.join(' | ')}`);
      }
      // les outils restent disponibles pour l'agent ; le mode dontAsk laisse lire le dossier de travail et les dossiers --add-dir, et refuse le reste
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Glob,Grep,Write');
      assert.equal(valeurApres(c.args, '--permission-mode'), 'dontAsk');
      assert.deepEqual(c.args.filter((a, i) => c.args[i - 1] === '--add-dir'), [path.join(racine, 'data'), path.join(racine, 'out')]);
    } finally {
      nettoyer(racine);
    }
  });

  it('lecture seule : sans écriture ni autre outil, --allowedTools est omis (jamais une liste vide)', () => {
    const racine = creerProjet({ alpha: agentMd({ outils: 'Read, Glob' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      assert.ok(!c.args.includes('--allowedTools'));
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Glob');
    } finally {
      nettoyer(racine);
    }
  });

  it('une règle de lecture avec chemin, écrite dans agent.md, est conservée telle quelle', () => {
    const racine = creerProjet({ alpha: agentMd({ outils: 'Read, Read(//usr/share/doc/**), Write' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const autorisations = valeurApres(construireCommande(agent, configTest(), racine).args, '--allowedTools').split(',');
      assert.ok(autorisations.includes('Read(//usr/share/doc/**)'));
      assert.ok(!autorisations.includes('Read'));
    } finally {
      nettoyer(racine);
    }
  });

  it('une lecture écrite depuis la racine, « Read(agents/**) », ouvre ce dossier du projet par --add-dir, et rien hors du projet', () => {
    const racine = creerProjet({ alpha: agentMd({ outils: 'Read(agents/**), Glob(../**), Grep(.), Read(introuvable/**), Write' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      assert.deepEqual(c.args.filter((a, i) => c.args[i - 1] === '--add-dir'), [path.join(racine, 'data'), path.join(racine, 'out'), path.join(racine, 'agents')]);
      // aucune règle relative dans --allowedTools : seule l'écriture dans out/alpha/ y est
      assert.deepEqual(valeurApres(c.args, '--allowedTools').split(','), [`Edit(/${echapperMotif(path.join(racine, 'out', 'alpha'))}/**)`]);
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Glob,Grep,Write');
      assert.equal(dossierEnLecture('Read(//usr/share/doc/**)', racine), undefined);
      assert.equal(dossierEnLecture('Read(../**)', racine), null);
      assert.equal(dossierEnLecture('Read(data/**)', racine), path.join(racine, 'data'));
      fs.mkdirSync(path.join(racine, '.cache'));
      assert.equal(dossierEnLecture('Read(.cache/**)', racine), null);
    } finally {
      nettoyer(racine);
    }
  });

  it('Bash n\'est disponible que si agent.md le demande, et passe tel quel (avec son motif)', () => {
    const racine = creerProjet({ alpha: agentMd({ outils: 'Read, Bash(ls *), Write' }) });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      const c = construireCommande(agent, configTest(), racine);
      assert.equal(valeurApres(c.args, '--tools'), 'Read,Bash,Write');
      assert.ok(valeurApres(c.args, '--allowedTools').split(',').includes('Bash(ls *)'));
    } finally {
      nettoyer(racine);
    }
  });

  it('sans modèle dans la configuration, garde le modèle par défaut du compte', () => {
    const racine = creerProjet({ alpha: agentMd() });
    try {
      const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
      assert.ok(!construireCommande(agent, configTest({ modele: '' }), racine).args.includes('--model'));
    } finally {
      nettoyer(racine);
    }
  });

  it('échappe les caractères spéciaux d\'un chemin dans la règle d\'écriture', () => {
    assert.equal(echapperMotif('/a/[b]/c*/d?'), '/a/\\[b\\]/c\\*/d\\?');
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-[test]-')));
    try {
      const racine = path.join(base, 'projet');
      fs.mkdirSync(racine);
      fs.mkdirSync(path.join(racine, 'agents', 'alpha'), { recursive: true });
      const agent = lireAgentMd(agentMd(), 'alpha');
      const regle = valeurApres(construireCommande(agent, configTest(), racine).args, '--allowedTools');
      assert.match(regle, /cockpit-\\\[test\\\]-/);
    } finally {
      nettoyer(base);
    }
  });
});

describe('executer : un vrai passage avec le faux claude', () => {
  async function passage(variables = {}, config = {}, agentOptions = {}) {
    const racine = creerProjet({ alpha: agentMd(agentOptions) });
    const agent = lireAgentMd(fs.readFileSync(path.join(racine, 'agents', 'alpha', 'agent.md'), 'utf8'), 'alpha');
    const lignes = [];
    const entree = await avecEnv(variables, () => executer({
      agent, config: configTest(config), racine, declencheur: 'manuel', surLigne: (l) => lignes.push(l),
    }).promesse);
    return { racine, entree, lignes, agent };
  }

  it('succès : coût converti en euros, durée et tours lus dans « result », fichier produit, ligne de journal écrite', async () => {
    const { racine, entree, lignes } = await passage({ FAKE_COUT: '0.1' }, { taux_usd_eur: 0.86 });
    try {
      assert.equal(entree.statut, 'reussi');
      assert.equal(entree.cout_usd, 0.1);
      assert.equal(entree.cout_eur, 0.086);
      assert.equal(entree.taux_usd_eur, 0.86);
      assert.equal(entree.duree_ms, 1234);
      assert.equal(entree.tours, 3);
      assert.equal(entree.resultat, 'out/alpha/resultat.md');
      assert.deepEqual(entree.fichiers, ['out/alpha/resultat.md']);
      assert.equal(entree.erreur, null);
      assert.equal(entree.modele, 'claude-fake-1');
      assert.equal(entree.source_cle, 'none');
      assert.equal(entree.version_claude, '2.1.999');
      assert.equal(entree.declencheur, 'manuel');

      const dansLeJournal = lireJour(path.join(racine, 'journal'), jourLocal(new Date(entree.debut)));
      assert.equal(dansLeJournal.length, 1);
      assert.deepEqual(dansLeJournal[0], entree);

      const textes = lignes.map((l) => l.texte);
      assert.ok(textes.includes('Lit data/lisez-moi.txt'), textes.join('\n'));
      assert.ok(textes.includes('Écrit out/alpha/resultat.md (27 caractères)'), textes.join('\n'));
      assert.ok(textes.some((t) => t.startsWith('Terminé en 1 s · 3 tours · 0,086 €')), textes.join('\n'));
      for (const l of lignes) assert.ok(!/^\s*[{[]/.test(l.texte), `JSON brut à l'écran : ${l.texte}`);
    } finally {
      nettoyer(racine);
    }
  });

  it('accorde les compteurs de la console : « 1 outil » et « 1 tour » au singulier, « 2 outils » et « 2 tours » dès deux, « 0 outil » à zéro', async () => {
    for (const [outils, tours, attenduOutils, attenduTours] of [['Read', '1', '1 outil', '1 tour'], ['Read,Write', '2', '2 outils', '2 tours'], ['', '10', '0 outil', '10 tours']]) {
      const { racine, lignes } = await passage({ FAKE_OUTILS: outils, FAKE_TOURS: tours });
      try {
        const textes = lignes.map((l) => l.texte);
        assert.ok(textes.some((t) => t.startsWith('Claude Code 2.1.999 démarré') && t.endsWith(`· ${attenduOutils}`)), textes.join('\n'));
        assert.ok(textes.some((t) => t.startsWith(`Terminé en 1 s · ${attenduTours} · `)), textes.join('\n'));
        assert.ok(!textes.some((t) => /\b[01] (outils|tours)\b/.test(t)), 'jamais « 0 outils », « 1 outils » ni « 1 tours »');
      } finally {
        nettoyer(racine);
      }
    }
  });

  it('transmet la consigne telle quelle sur l\'entrée standard, et les options attendues', async () => {
    const fichier = path.join(os.tmpdir(), `args-${process.pid}-${Date.now()}.json`);
    const consigne = '# Titre\n\nFais ceci :\n- un\n- deux\n\n```\nbloc\n```';
    const { racine } = await passage({ FAKE_ARGS_FILE: fichier }, {}, { prompt: consigne, tours: 4 });
    try {
      const recu = JSON.parse(fs.readFileSync(fichier, 'utf8'));
      assert.equal(recu.prompt, consigne);
      assert.equal(recu.args[recu.args.indexOf('--max-turns') + 1], '4');
      assert.equal(recu.cwd, path.join(racine, 'agents', 'alpha'));
      assert.equal(recu.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    } finally {
      fs.rmSync(fichier, { force: true });
      nettoyer(racine);
    }
  });

  it('échec d\'exécution : statut echec, coût quand même relevé', async () => {
    const { racine, entree } = await passage({ FAKE_CLAUDE: 'echec', FAKE_COUT: '0.02' });
    try {
      assert.equal(entree.statut, 'echec');
      assert.equal(entree.cout_usd, 0.02);
      assert.match(entree.erreur, /panne simulée/);
    } finally {
      nettoyer(racine);
    }
  });

  it('nombre de tours épuisé : message qui dit quoi faire', async () => {
    const { racine, entree, lignes } = await passage({ FAKE_CLAUDE: 'max_tours' }, {}, { tours: 3 });
    try {
      assert.equal(entree.statut, 'echec');
      assert.ok(lignes.some((l) => l.texte.startsWith('Échec : nombre maximal de tours atteint (3). Augmente max_tours')), 'minuscule après les deux-points');
      assert.match(entree.erreur, /Nombre maximal de tours atteint \(3\)\. Augmente max_tours/);
    } finally {
      nettoyer(racine);
    }
  });

  it('arrêt brutal sans résultat : échec, coût inconnu (null), raison lisible', async () => {
    const { racine, entree, lignes } = await passage({ FAKE_CLAUDE: 'sans_result' });
    try {
      assert.equal(entree.statut, 'echec');
      assert.equal(entree.cout_usd, null);
      assert.equal(entree.cout_eur, null);
      assert.equal(entree.cout_estime_eur, 0.15, 'le budget compte l\'estimation prudente (celle de config.json faute d\'historique)');
      assert.match(entree.erreur, /sans résultat \(code 3\).*panne simulée/);
      assert.ok(lignes.some((l) => l.texte.includes('Coût inconnu : l\'estimation prudente (0,15 €) est comptée dans le budget du jour.')), lignes.map((l) => l.texte).join('\n'));
      assert.ok(lignes.some((l) => l.texte.startsWith('Échec : Claude Code s\'est arrêté sans résultat (code 3).')), 'le nom propre garde sa majuscule après les deux-points');
    } finally {
      nettoyer(racine);
    }
  });

  it('silence prolongé : le délai maximal interrompt le passage', async () => {
    const { racine, entree } = await passage({ FAKE_CLAUDE: 'silence' }, { delai_max_s: 0.4 });
    try {
      assert.equal(entree.statut, 'echec');
      assert.match(entree.erreur, /Délai maximal dépassé/);
      assert.equal(entree.cout_eur, null);
    } finally {
      nettoyer(racine);
    }
  });

  it('claude introuvable : échec explicite, rien de dépensé', async () => {
    const { racine, entree } = await passage({}, { commande_claude: '/chemin/qui/nexiste/pas/claude' });
    try {
      assert.equal(entree.statut, 'echec');
      assert.match(entree.erreur, /Claude Code est introuvable/);
      assert.equal(entree.cout_eur, 0);
    } finally {
      nettoyer(racine);
    }
  });

  it('écriture refusée : la ligne le dit clairement', async () => {
    const { racine, entree, lignes } = await passage({ FAKE_CLAUDE: 'refus' });
    try {
      assert.equal(entree.statut, 'reussi');
      assert.ok(lignes.some((l) => l.texte === 'Refusé : rien n\'a été écrit dans /ailleurs/intrus.txt, hors du dossier de sortie de l\'agent'), lignes.map((l) => l.texte).join('\n'));
    } finally {
      nettoyer(racine);
    }
  });

  it('ne laisse fuir ni le dossier du projet ni le dossier personnel dans le journal', async () => {
    const { racine, entree, lignes } = await passage({ FAKE_CLAUDE: 'sans_result' });
    try {
      const tout = JSON.stringify(entree) + JSON.stringify(lignes);
      assert.ok(!tout.includes(racine), 'chemin du projet');
      assert.ok(!tout.includes(os.homedir()), 'dossier personnel');
    } finally {
      nettoyer(racine);
    }
  });
});

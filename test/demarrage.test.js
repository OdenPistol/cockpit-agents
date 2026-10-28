import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NODE_MINIMUM, verifierVersionNode } from '../src/version.js';
import { FAUX_CLAUDE, RACINE_REELLE, agentMd, creerProjet, nettoyer } from './aide.js';

describe('version de Node', () => {
  it('accepte la version 22 et les suivantes', () => {
    assert.equal(NODE_MINIMUM, 22);
    for (const v of ['22.0.0', '22.23.3', '24.1.0', '30.0.0']) assert.equal(verifierVersionNode(v), null, v);
  });

  it('refuse une version plus ancienne, avec un message qui dit quoi faire', () => {
    for (const v of ['20.11.0', '18.19.1', '21.7.3', '8.0.0']) {
      const message = verifierVersionNode(v);
      assert.match(message, new RegExp(`^Node\\.js ${v.replace(/\./g, '\\.')} est trop ancien : il faut la version 22 ou plus\\. Installe la dernière version sur nodejs\\.org`), v);
    }
    assert.match(verifierVersionNode('abc'), /trop ancien/);
  });

  it('server.js et scripts/essai.js s\'arrêtent proprement avec ce message sous un Node simulé en version 20', () => {
    const shim = path.join(RACINE_REELLE, 'test', 'fixtures', 'simuler-node-20.mjs');
    for (const script of ['server.js', path.join('scripts', 'essai.js')]) {
      const r = spawnSync(process.execPath, ['--import', shim, script, '--sans-navigateur'], { cwd: RACINE_REELLE, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 1, `${script} : code de sortie ${r.status}`);
      assert.match(r.stderr, /✖ Node\.js 20\.11\.0 est trop ancien : il faut la version 22 ou plus\./, script);
      assert.ok(!/at |Error|SyntaxError/.test(r.stderr), `${script} : pas de trace d'erreur incompréhensible`);
      assert.equal(r.stdout, '', `${script} ne démarre rien`);
    }
  });
});

describe('démarrage : adresse affichée et ouverte', { skip: process.platform === 'win32' && 'ouverture du navigateur : macOS et Linux' }, () => {
  it('affiche et ouvre http://127.0.0.1:<port> (pas « localhost »), sans tiret, puis s\'arrête proprement', async () => {
    const racine = creerProjet({ alpha: agentMd({ budget: 5 }) });
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-bin-'));
    const appels = path.join(bin, 'appels.txt');
    let enfant = null;
    try {
      for (const nom of ['open', 'xdg-open']) {
        fs.writeFileSync(path.join(bin, nom), `#!/bin/sh\necho "$@" >> "${appels}"\n`, { mode: 0o755 });
      }
      fs.cpSync(path.join(RACINE_REELLE, 'src'), path.join(racine, 'src'), { recursive: true });
      fs.copyFileSync(path.join(RACINE_REELLE, 'server.js'), path.join(racine, 'server.js'));
      fs.copyFileSync(path.join(RACINE_REELLE, 'package.json'), path.join(racine, 'package.json'));
      fs.writeFileSync(path.join(racine, 'config.json'), JSON.stringify({ port: 0, commande_claude: FAUX_CLAUDE, ouvrir_navigateur: true }));

      enfant = spawn(process.execPath, ['server.js'], { cwd: racine, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
      let sortie = '';
      enfant.stderr.on('data', (d) => { sortie += d; });
      const fini = new Promise((resolve) => enfant.on('close', (code) => resolve(code)));
      await new Promise((resolve, reject) => {
        const minuteur = setTimeout(() => reject(new Error(`démarrage trop long. Sortie : ${sortie}`)), 15000);
        enfant.stdout.on('data', (d) => {
          sortie += d;
          if (sortie.includes('Ctrl+C')) { clearTimeout(minuteur); resolve(); }
        });
      });
      const url = /Écran\s+(http:\/\/\S+)/.exec(sortie)?.[1];
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, sortie);
      assert.ok(!sortie.includes('localhost'), 'on affiche 127.0.0.1, pas localhost');
      assert.ok(!/[\u2013\u2014]/.test(sortie), 'aucun tiret dans la bannière');
      assert.match(sortie, /Cockpit d'agents prêt/);
      assert.match(sortie, /Claude Code 2\.1\.999 · abonnement : les coûts sont des équivalents API/);

      // Le faux « open » est un petit script lancé à part : on attend (jusqu'à 8 s) qu'il ait écrit son appel.
      for (let i = 0; i < 160 && !(fs.existsSync(appels) && fs.readFileSync(appels, 'utf8').trim() !== ''); i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(fs.readFileSync(appels, 'utf8').trim(), url, 'le navigateur est ouvert sur la même adresse');
      assert.equal((await fetch(url)).status, 200);

      enfant.kill('SIGINT');
      assert.equal(await fini, 0, 'arrêt propre avec Ctrl+C');
    } finally {
      // Même si une vérification échoue, le serveur lancé par le test ne doit jamais rester en vie.
      if (enfant && enfant.exitCode === null && enfant.signalCode === null) enfant.kill('SIGKILL');
      nettoyer(racine);
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe('démarrage : accord des agents illisibles dans la bannière', () => {
  async function banniere(agents) {
    const racine = creerProjet(agents);
    let enfant = null;
    try {
      fs.cpSync(path.join(RACINE_REELLE, 'src'), path.join(racine, 'src'), { recursive: true });
      fs.copyFileSync(path.join(RACINE_REELLE, 'server.js'), path.join(racine, 'server.js'));
      fs.copyFileSync(path.join(RACINE_REELLE, 'package.json'), path.join(racine, 'package.json'));
      fs.writeFileSync(path.join(racine, 'config.json'), JSON.stringify({ port: 0, commande_claude: FAUX_CLAUDE, ouvrir_navigateur: false }));
      enfant = spawn(process.execPath, ['server.js', '--sans-navigateur'], { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'] });
      let sortie = '';
      enfant.stderr.on('data', (d) => { sortie += d; });
      const fini = new Promise((resolve) => enfant.on('close', resolve));
      await new Promise((resolve, reject) => {
        const minuteur = setTimeout(() => reject(new Error(`démarrage trop long. Sortie : ${sortie}`)), 15000);
        enfant.stdout.on('data', (d) => {
          sortie += d;
          if (sortie.includes('Ctrl+C')) { clearTimeout(minuteur); resolve(); }
        });
      });
      enfant.kill('SIGINT');
      await fini;
      return sortie;
    } finally {
      if (enfant && enfant.exitCode === null && enfant.signalCode === null) enfant.kill('SIGKILL');
      nettoyer(racine);
    }
  }

  it('« 1 illisible » au singulier, « 2 illisibles » au pluriel, rien quand tout est lisible', async () => {
    const ok = agentMd({ budget: 5 });
    assert.match(await banniere({ alpha: ok }), /Agents {6}1\n/);
    assert.match(await banniere({ alpha: ok, casse: 'pas un agent' }), /Agents {6}1 \(\+ 1 illisible, voir l'écran\)/);
    const deux = await banniere({ alpha: ok, casse: 'pas un agent', casse2: 'pas un agent non plus' });
    assert.match(deux, /Agents {6}1 \(\+ 2 illisibles, voir l'écran\)/);
    assert.ok(!/illisible\(s\)/.test(deux));
  });
});

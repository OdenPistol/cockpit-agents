import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { messagePortOccupe } from '../src/serveur.js';
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

describe('démarrage : choisir le port sans toucher à config.json (PORT=4322 npm start)', () => {
  /** Un faux programme qui occupe un port : « l'autre copie du cockpit » (celle d'une autre vidéo, par exemple). */
  function occuperUnPort() {
    return new Promise((resolve) => {
      const serveur = net.createServer((socket) => socket.end('autre copie\n'));
      serveur.listen(0, '127.0.0.1', () => resolve({ serveur, port: serveur.address().port }));
    });
  }
  const fermer = (serveur) => new Promise((resolve) => serveur.close(resolve));
  async function portLibre() {
    const { serveur, port } = await occuperUnPort();
    await fermer(serveur);
    return port;
  }
  /** L'autre programme répond toujours : rien ne l'a arrêté, rien ne l'a remplacé. */
  const occupantVivant = (port) => new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let recu = '';
    socket.on('data', (d) => { recu += d; });
    socket.on('close', () => resolve(recu));
    socket.on('error', reject);
  });

  function copierProjet(portConfig) {
    const racine = creerProjet({ alpha: agentMd({ budget: 5 }) });
    fs.cpSync(path.join(RACINE_REELLE, 'src'), path.join(racine, 'src'), { recursive: true });
    fs.copyFileSync(path.join(RACINE_REELLE, 'server.js'), path.join(racine, 'server.js'));
    fs.copyFileSync(path.join(RACINE_REELLE, 'package.json'), path.join(racine, 'package.json'));
    fs.writeFileSync(path.join(racine, 'config.json'), JSON.stringify({ port: portConfig, commande_claude: FAUX_CLAUDE, ouvrir_navigateur: false }));
    return racine;
  }

  /** Lance `node server.js` avec la variable PORT donnée (ou aucune) ; rend la sortie, le code de sortie, et de quoi l'arrêter. */
  function lancer(racine, port) {
    const environnement = { ...process.env };
    delete environnement.PORT; // le test ne dépend pas de ce que l'environnement de la machine contient
    if (port !== undefined) environnement.PORT = port;
    const enfant = spawn(process.execPath, ['server.js', '--sans-navigateur'], { cwd: racine, env: environnement, stdio: ['ignore', 'pipe', 'pipe'] });
    const etat = { sortie: '', erreurs: '' };
    enfant.stdout.on('data', (d) => { etat.sortie += d; });
    enfant.stderr.on('data', (d) => { etat.erreurs += d; });
    const fini = new Promise((resolve) => enfant.on('close', (code) => resolve(code)));
    const pret = new Promise((resolve, reject) => {
      const minuteur = setTimeout(() => reject(new Error(`démarrage trop long. Sortie : ${etat.sortie} ${etat.erreurs}`)), 15000);
      enfant.stdout.on('data', () => {
        if (etat.sortie.includes('Ctrl+C')) { clearTimeout(minuteur); resolve('demarre'); }
      });
      enfant.on('close', () => { clearTimeout(minuteur); resolve('arrete'); });
    });
    return {
      etat,
      pret,
      fini,
      url: () => /Écran\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(etat.sortie)?.[1],
      async arreter() {
        if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill('SIGINT');
        return fini;
      },
      tuer() {
        if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill('SIGKILL');
      },
    };
  }

  it('port occupé : le message dit qu\'un autre programme, peut-être une autre copie du cockpit, l\'occupe, et propose d\'abord PORT=<port suivant> npm start', async () => {
    const { serveur, port } = await occuperUnPort();
    const racine = copierProjet(port);
    const avant = fs.readFileSync(path.join(racine, 'config.json'), 'utf8');
    const cockpit = lancer(racine);
    try {
      assert.equal(await cockpit.pret, 'arrete', 'le cockpit ne démarre pas sur un port pris');
      assert.equal(await cockpit.fini, 1);
      const message = cockpit.etat.erreurs;
      assert.ok(message.includes(`Le port ${port} est déjà utilisé : un autre programme, peut-être une autre copie du cockpit, l'occupe.`), message);
      assert.ok(message.includes(`PORT=${port + 1} npm start`), message);
      assert.ok(message.indexOf('PORT=') < message.indexOf('config.json'), 'PORT=… d\'abord, config.json ensuite');
      assert.ok(!/ouvre|arrête|\bkill\b|\btue\b/i.test(message), 'ni « ouvre ce port » (ce serait l\'autre programme) ni « arrête » : on ne touche pas à l\'autre');
      assert.equal(cockpit.etat.sortie, '', 'rien n\'est annoncé comme prêt');
      assert.equal(await occupantVivant(port), 'autre copie\n', 'l\'autre programme répond toujours');
      assert.equal(fs.readFileSync(path.join(racine, 'config.json'), 'utf8'), avant, 'config.json n\'a pas bougé');
    } finally {
      cockpit.tuer();
      await fermer(serveur);
      nettoyer(racine);
    }
  });

  it('PORT=<port libre> : le cockpit démarre sur ce port, à côté de l\'autre, qui n\'est pas touché ; config.json non plus ; l\'adresse affichée est la bonne', async () => {
    const { serveur, port } = await occuperUnPort();
    const libre = await portLibre();
    const racine = copierProjet(port);
    const avant = fs.readFileSync(path.join(racine, 'config.json'), 'utf8');
    const cockpit = lancer(racine, String(libre));
    try {
      assert.equal(await cockpit.pret, 'demarre', cockpit.etat.erreurs);
      assert.equal(cockpit.url(), `http://127.0.0.1:${libre}`, 'l\'adresse affichée est celle du port demandé, pas celle de config.json');
      assert.match(cockpit.etat.sortie, new RegExp(`Écran {7}http://127\\.0\\.0\\.1:${libre} \\(port choisi par la variable PORT\\)\n`));
      assert.equal((await fetch(cockpit.url())).status, 200, 'l\'écran répond sur cette adresse');
      assert.equal(await occupantVivant(port), 'autre copie\n', 'l\'autre programme répond toujours');
      assert.equal(fs.readFileSync(path.join(racine, 'config.json'), 'utf8'), avant, 'config.json n\'a pas bougé');
      assert.equal(await cockpit.arreter(), 0, 'arrêt propre avec Ctrl+C');
      assert.equal(await occupantVivant(port), 'autre copie\n', 'et il répond encore après l\'arrêt de celui-ci');
    } finally {
      cockpit.tuer();
      await fermer(serveur);
      nettoyer(racine);
    }
  });

  it('PORT=0 : le système donne un port libre, et la bannière affiche ce port réel, celui qui répond', async () => {
    const { serveur, port } = await occuperUnPort();
    const racine = copierProjet(port);
    const cockpit = lancer(racine, '0');
    try {
      assert.equal(await cockpit.pret, 'demarre', cockpit.etat.erreurs);
      const url = cockpit.url();
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(url, 'http://127.0.0.1:0', 'jamais le port 0 : le port réel');
      assert.notEqual(url, `http://127.0.0.1:${port}`);
      assert.equal((await fetch(url)).status, 200);
      await cockpit.arreter();
    } finally {
      cockpit.tuer();
      await fermer(serveur);
      nettoyer(racine);
    }
  });

  it('sans PORT, le port de config.json est utilisé et la bannière ne parle pas de la variable', async () => {
    const libre = await portLibre();
    const racine = copierProjet(libre);
    const cockpit = lancer(racine);
    try {
      assert.equal(await cockpit.pret, 'demarre', cockpit.etat.erreurs);
      assert.equal(cockpit.url(), `http://127.0.0.1:${libre}`);
      assert.ok(!cockpit.etat.sortie.includes('variable PORT'));
      await cockpit.arreter();
    } finally {
      cockpit.tuer();
      nettoyer(racine);
    }
  });

  it('PORT vide : ignoré, comme s\'il n\'existait pas', async () => {
    const libre = await portLibre();
    const racine = copierProjet(libre);
    const cockpit = lancer(racine, '   ');
    try {
      assert.equal(await cockpit.pret, 'demarre', cockpit.etat.erreurs);
      assert.equal(cockpit.url(), `http://127.0.0.1:${libre}`);
      await cockpit.arreter();
    } finally {
      cockpit.tuer();
      nettoyer(racine);
    }
  });

  it('PORT qui n\'est pas un numéro de port : refusé avec un exemple, rien ne démarre', async () => {
    for (const mauvais of ['abc', '4322x', '-1', '65536', '12.5']) {
      const racine = copierProjet(0);
      const cockpit = lancer(racine, mauvais);
      try {
        assert.equal(await cockpit.pret, 'arrete', mauvais);
        assert.equal(await cockpit.fini, 1, mauvais);
        assert.ok(cockpit.etat.erreurs.includes(`la variable PORT vaut « ${mauvais} » : un numéro de port entre 0 et 65535 est attendu (exemple : PORT=4322 npm start)`), cockpit.etat.erreurs);
        assert.equal(cockpit.etat.sortie, '');
      } finally {
        cockpit.tuer();
        nettoyer(racine);
      }
    }
  });

  it('le message de port occupé : l\'autre port proposé suit celui qui est pris, jamais au-delà de 65535', () => {
    assert.match(messagePortOccupe(4321), /^Le port 4321 est déjà utilisé : un autre programme, peut-être une autre copie du cockpit, l'occupe\. Pour lancer celui-ci à côté, sans toucher à l'autre : PORT=4322 npm start \(ou change « port » dans config\.json\)\.$/);
    assert.match(messagePortOccupe(8080), /PORT=8081 npm start/);
    assert.match(messagePortOccupe(65535), /PORT=65534 npm start/);
  });
});

// npm run remise-a-zero : vide out/<agent>/ et journal/*.jsonl, garde les .gitkeep, ne touche à rien d'autre.
// Tous les essais se font dans des projets jetables : jamais sur le vrai dossier du cockpit.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { remiseAZero } from '../src/remise-a-zero.js';
import { RACINE_REELLE, agentMd, creerProjet, nettoyer } from './aide.js';

const ecrire = (racine, relatif, contenu = 'x\n') => {
  const complet = path.join(racine, relatif);
  fs.mkdirSync(path.dirname(complet), { recursive: true });
  fs.writeFileSync(complet, contenu);
};
const existe = (racine, relatif) => fs.existsSync(path.join(racine, relatif));

/** Un projet jetable avec des sorties, des journaux et des fichiers qui ne doivent jamais bouger. */
function projet() {
  const racine = creerProjet({ alpha: agentMd() });
  fs.writeFileSync(path.join(racine, 'package.json'), '{"name":"cockpit-agents"}\n');
  fs.writeFileSync(path.join(racine, 'config.json'), '{"port":4321}\n');
  for (const f of ['out/.gitkeep', 'journal/.gitkeep']) ecrire(racine, f, '');
  ecrire(racine, 'out/factures/relances-2026-10-29.md');
  ecrire(racine, 'out/juge/verdict-factures-2026-10-29-1.md');
  ecrire(racine, 'out/juge/verdict-factures-2026-10-29-2.md');
  ecrire(racine, 'out/veille/sous-dossier/profond.md');
  ecrire(racine, 'out/gardé/.gitkeep', '');
  ecrire(racine, 'out/gardé/reste.md');
  ecrire(racine, 'out/fichier-isole-a-la-racine.txt');
  ecrire(racine, 'journal/2026-10-28.jsonl', '{}\n');
  ecrire(racine, 'journal/2026-10-29.jsonl', '{}\n');
  ecrire(racine, 'journal/serveur.log', 'journal du système\n');
  ecrire(racine, 'data/factures/factures.csv', 'données\n');
  ecrire(racine, 'agents/alpha/dod.md', '1. Un critère.\n');
  return racine;
}

describe('npm run remise-a-zero : ce qui part, ce qui reste', () => {
  it('vide chaque out/<agent>/ et supprime journal/*.jsonl, garde les .gitkeep', () => {
    const racine = projet();
    try {
      const sortie = [];
      const r = remiseAZero({ racine, afficher: (t) => sortie.push(t) });
      assert.deepEqual(r, { dossiers: 4, fichiers: 5, journaux: 2 });
      for (const parti of [
        'out/factures', 'out/juge', 'out/veille', 'out/gardé/reste.md',
        'journal/2026-10-28.jsonl', 'journal/2026-10-29.jsonl',
      ]) assert.ok(!existe(racine, parti), `${parti} devrait avoir disparu`);
      for (const reste of ['out/.gitkeep', 'journal/.gitkeep', 'out/gardé/.gitkeep']) assert.ok(existe(racine, reste), `${reste} devrait rester`);
      assert.match(sortie.join('\n'), /Remise à zéro : 4 dossiers de sortie vidés \(5 fichiers supprimés\), 2 fichiers de journal supprimés\./);
      assert.match(sortie.join('\n'), /repartent de zéro : ils se relisent dans le journal/);
    } finally {
      nettoyer(racine);
    }
  });

  it('ne touche à rien d\'autre : agents/, data/, config.json, package.json, un fichier isolé de out/, les journaux du système (.log)', () => {
    const racine = projet();
    try {
      const photo = () => ['agents/alpha/agent.md', 'agents/alpha/dod.md', 'data/factures/factures.csv', 'data/lisez-moi.txt', 'config.json', 'package.json', 'out/fichier-isole-a-la-racine.txt', 'journal/serveur.log']
        .map((f) => `${f}=${fs.readFileSync(path.join(racine, f), 'utf8')}`);
      const avant = photo();
      remiseAZero({ racine, afficher: () => {} });
      assert.deepEqual(photo(), avant);
      assert.ok(existe(racine, 'public/index.html'));
    } finally {
      nettoyer(racine);
    }
  });

  it('ne suit jamais un lien symbolique : le lien est supprimé, ce qu\'il désigne reste', () => {
    const racine = projet();
    const dehors = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-dehors-'));
    try {
      ecrire(dehors, 'precieux.txt', 'à ne jamais supprimer\n');
      fs.symlinkSync(dehors, path.join(racine, 'out', 'lien-vers-dehors'));
      fs.symlinkSync(path.join(dehors, 'precieux.txt'), path.join(racine, 'out', 'factures', 'lien-fichier.md'));
      fs.symlinkSync(path.join(dehors, 'precieux.txt'), path.join(racine, 'journal', '2026-10-27.jsonl'));
      remiseAZero({ racine, afficher: () => {} });
      for (const lien of [['out', 'lien-vers-dehors'], ['out', 'factures', 'lien-fichier.md'], ['journal', '2026-10-27.jsonl']]) {
        assert.throws(() => fs.lstatSync(path.join(racine, ...lien)), { code: 'ENOENT' }, `${lien.join('/')} : le lien est supprimé`);
      }
      assert.equal(fs.readFileSync(path.join(dehors, 'precieux.txt'), 'utf8'), 'à ne jamais supprimer\n');
      assert.deepEqual(fs.readdirSync(dehors), ['precieux.txt']);
    } finally {
      nettoyer(racine);
      fs.rmSync(dehors, { recursive: true, force: true });
    }
  });

  it('rien à supprimer : le dit, une seconde fois comme la première', () => {
    const racine = projet();
    try {
      remiseAZero({ racine, afficher: () => {} });
      // « out/gardé/ » garde son .gitkeep : il n'y a plus rien d'autre à supprimer
      const sortie = [];
      const r = remiseAZero({ racine, afficher: (t) => sortie.push(t) });
      assert.deepEqual(r, { dossiers: 0, fichiers: 0, journaux: 0 }, 'le dossier qui ne garde que son .gitkeep n\'a rien perdu');
      assert.deepEqual(sortie, ['Rien à remettre à zéro : out/ et journal/ sont déjà vides.']);
      const vide = creerProjet({});
      fs.writeFileSync(path.join(vide, 'package.json'), '{}');
      fs.mkdirSync(path.join(vide, 'agents'));
      fs.rmSync(path.join(vide, 'out'), { recursive: true });
      fs.rmSync(path.join(vide, 'journal'), { recursive: true });
      const messages = [];
      assert.deepEqual(remiseAZero({ racine: vide, afficher: (t) => messages.push(t) }), { dossiers: 0, fichiers: 0, journaux: 0 });
      assert.deepEqual(messages, ['Rien à remettre à zéro : out/ et journal/ sont déjà vides.']);
      nettoyer(vide);
    } finally {
      nettoyer(racine);
    }
  });

  it('un dossier qui ne ressemble pas au cockpit : refusé, rien n\'est supprimé', () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-un-cockpit-'));
    try {
      ecrire(dossier, 'out/important/a.md');
      ecrire(dossier, 'journal/2026-10-29.jsonl');
      assert.throws(() => remiseAZero({ racine: dossier, afficher: () => {} }), /ne ressemble pas au cockpit \(il manque package\.json ou agents\/\) : rien n'est supprimé/);
      assert.ok(existe(dossier, 'out/important/a.md') && existe(dossier, 'journal/2026-10-29.jsonl'));
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('accorde « 1 dossier de sortie vidé », « 1 fichier de journal supprimé » au singulier', () => {
    const racine = creerProjet({});
    try {
      fs.writeFileSync(path.join(racine, 'package.json'), '{}');
      fs.mkdirSync(path.join(racine, 'agents'), { recursive: true });
      fs.rmSync(path.join(racine, 'out'), { recursive: true });
      ecrire(racine, 'out/seul/a.md');
      ecrire(racine, 'journal/2026-10-29.jsonl');
      const sortie = [];
      remiseAZero({ racine, afficher: (t) => sortie.push(t) });
      assert.match(sortie[0], /^Remise à zéro : 1 dossier de sortie vidé \(1 fichier supprimé\), 1 fichier de journal supprimé\.$/);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('npm run remise-a-zero : la commande', () => {
  it('le script de package.json lance scripts/remise-a-zero.js ; ce script n\'utilise aucun motif de shell ni aucune commande externe', () => {
    const paquet = JSON.parse(fs.readFileSync(path.join(RACINE_REELLE, 'package.json'), 'utf8'));
    assert.equal(paquet.scripts['remise-a-zero'], 'node scripts/remise-a-zero.js');
    for (const f of ['scripts/remise-a-zero.js', 'src/remise-a-zero.js']) {
      const source = fs.readFileSync(path.join(RACINE_REELLE, f), 'utf8').replace(/\/\/.*$/gm, '');
      assert.ok(!/child_process|execSync|execFile|spawn|\brm -rf\b/.test(source), `${f} : pas de commande externe ni de motif de shell`);
    }
  });

  it('lancé dans une copie du projet, le script vide out/ et journal/ de cette copie et le dit, sans rien afficher d\'autre ; le vrai dossier n\'est pas touché', () => {
    const racine = projet();
    try {
      fs.cpSync(path.join(RACINE_REELLE, 'src'), path.join(racine, 'src'), { recursive: true });
      fs.cpSync(path.join(RACINE_REELLE, 'scripts'), path.join(racine, 'scripts'), { recursive: true });
      const r = spawnSync(process.execPath, ['scripts/remise-a-zero.js'], { cwd: racine, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^Remise à zéro : 4 dossiers de sortie vidés \(5 fichiers supprimés\), 2 fichiers de journal supprimés\.\n/);
      assert.ok(!/[\u2013\u2014]/.test(r.stdout));
      assert.ok(!existe(racine, 'out/factures') && !existe(racine, 'journal/2026-10-29.jsonl'));
      assert.ok(existe(racine, 'out/.gitkeep') && existe(racine, 'journal/.gitkeep'));
      assert.ok(existe(racine, 'data/factures/factures.csv'));
    } finally {
      nettoyer(racine);
    }
  });

  it('sous un Node trop ancien, le script s\'arrête avec le même message que les autres commandes', () => {
    const shim = path.join(RACINE_REELLE, 'test', 'fixtures', 'simuler-node-20.mjs');
    const r = spawnSync(process.execPath, ['--import', shim, path.join('scripts', 'remise-a-zero.js')], { cwd: RACINE_REELLE, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /✖ Node\.js 20\.11\.0 est trop ancien : il faut la version 22 ou plus\./);
    assert.equal(r.stdout, '', 'rien n\'est supprimé');
  });
});

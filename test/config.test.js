// config.json : valeurs par défaut, clé renommée « configuration_isolee » (ex « configuration_propre »), messages clairs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chargerConfig, ConfigError, DEFAUTS, portDeLEnvironnement, validerConfig } from '../src/config.js';
import { RACINE_REELLE } from './aide.js';

describe('configuration_isolee : la configuration isolée des agents', () => {
  it('vaut true par défaut, et le config.json livré la porte', () => {
    assert.equal(DEFAUTS.configuration_isolee, true);
    assert.equal(validerConfig({}).configuration_isolee, true);
    const livre = JSON.parse(fs.readFileSync(path.join(RACINE_REELLE, 'config.json'), 'utf8'));
    assert.equal(livre.configuration_isolee, true);
    assert.ok(!('configuration_propre' in livre), 'l\'ancien nom a disparu du fichier livré');
    assert.equal(chargerConfig(RACINE_REELLE).configuration_isolee, true);
  });

  it('accepte true et false, refuse autre chose avec un message clair', () => {
    assert.equal(validerConfig({ configuration_isolee: false }).configuration_isolee, false);
    assert.throws(() => validerConfig({ configuration_isolee: 'oui' }), (e) => e instanceof ConfigError && /« configuration_isolee » doit être true ou false/.test(e.message));
  });

  it('l\'ancien nom « configuration_propre » n\'est plus lu en silence : le message donne le nouveau nom', () => {
    assert.throws(
      () => validerConfig({ configuration_propre: false }),
      (e) => e instanceof ConfigError && /la clé « configuration_propre » s'appelle maintenant « configuration_isolee » \(même sens : renomme-la\)/.test(e.message),
    );
  });

  it('une clé inconnue est refusée avec la liste des clés possibles, qui contient le nouveau nom et pas l\'ancien', () => {
    assert.throws(() => validerConfig({ nimporte: 1 }), (e) => {
      assert.match(e.message, /la clé « nimporte » n'existe pas/);
      assert.match(e.message, /configuration_isolee/);
      assert.ok(!/configuration_propre/.test(e.message));
      return true;
    });
  });
});

describe('PORT : changer de port sans toucher à config.json', () => {
  it('absent ou vide : null (le port de config.json reste celui qui sert)', () => {
    assert.equal(portDeLEnvironnement({}), null);
    assert.equal(portDeLEnvironnement({ PORT: '' }), null);
    assert.equal(portDeLEnvironnement({ PORT: '   ' }), null);
    assert.equal(portDeLEnvironnement({ PORT: undefined }), null);
  });

  it('un numéro de port entre 0 et 65535 : lu tel quel (les espaces autour sont ignorés)', () => {
    assert.equal(portDeLEnvironnement({ PORT: '4322' }), 4322);
    assert.equal(portDeLEnvironnement({ PORT: ' 4322 ' }), 4322);
    assert.equal(portDeLEnvironnement({ PORT: '0' }), 0);
    assert.equal(portDeLEnvironnement({ PORT: '65535' }), 65535);
    assert.equal(portDeLEnvironnement({ PORT: '04322' }), 4322);
  });

  it('autre chose : refusé, avec la valeur lue et un exemple', () => {
    for (const mauvais of ['abc', '4322x', '-1', '65536', '12.5', '1e3', '0x10', '123456']) {
      assert.throws(
        () => portDeLEnvironnement({ PORT: mauvais }),
        (e) => e instanceof ConfigError && e.message === `la variable PORT vaut « ${mauvais} » : un numéro de port entre 0 et 65535 est attendu (exemple : PORT=4322 npm start)`,
        mauvais,
      );
    }
  });

  it('config.json n\'est jamais lu ni modifié par PORT : la fonction ne fait que lire la variable', () => {
    const avant = fs.readFileSync(path.join(RACINE_REELLE, 'config.json'), 'utf8');
    portDeLEnvironnement({ PORT: '4322' });
    assert.equal(fs.readFileSync(path.join(RACINE_REELLE, 'config.json'), 'utf8'), avant);
    assert.equal(chargerConfig(RACINE_REELLE).port, 4321, 'le port du dépôt reste 4321');
  });
});

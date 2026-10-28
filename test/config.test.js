// config.json : valeurs par défaut, clé renommée « configuration_isolee » (ex « configuration_propre »), messages clairs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chargerConfig, ConfigError, DEFAUTS, validerConfig } from '../src/config.js';
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

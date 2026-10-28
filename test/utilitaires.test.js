// Accord en nombre des compteurs affichés : « 1 outil », « 2 outils ». Zéro et un restent au singulier.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compte, plurielSi } from '../src/utilitaires.js';

describe('plurielSi et compte : le mot qui suit un nombre', () => {
  it('zéro et un au singulier, deux et plus au pluriel', () => {
    for (const [n, attendu] of [[0, 'outil'], [1, 'outil'], [2, 'outils'], [3, 'outils'], [10, 'outils'], [1000, 'outils']]) {
      assert.equal(plurielSi(n, 'outil'), attendu, `${n}`);
      assert.equal(compte(n, 'outil'), `${n} ${attendu}`);
    }
  });

  it('un nombre à virgule inférieur à deux reste au singulier (« 1,5 outil »)', () => {
    assert.equal(plurielSi(1.5, 'outil'), 'outil');
    assert.equal(plurielSi(2.5, 'outil'), 'outils');
  });

  it('un nombre inconnu, absent ou vide garde le pluriel : « ? tours »', () => {
    for (const inconnu of ['?', '', '  ', null, undefined, Number.NaN]) assert.equal(plurielSi(inconnu, 'tour'), 'tours', String(inconnu));
    assert.equal(compte('?', 'tour'), '? tours');
  });

  it('un nombre écrit en texte compte comme un nombre', () => {
    assert.equal(compte('1', 'agent'), '1 agent');
    assert.equal(compte('2', 'agent'), '2 agents');
  });

  it('pluriel irrégulier fourni par l\'appelant', () => {
    assert.equal(compte(1, 'cheval', 'chevaux'), '1 cheval');
    assert.equal(compte(2, 'cheval', 'chevaux'), '2 chevaux');
  });

  it('les mots comptés à l\'écran', () => {
    const cas = [
      ['outil', 1, '1 outil'], ['outil', 4, '4 outils'], ['tour', 1, '1 tour'], ['tour', 10, '10 tours'],
      ['agent', 1, '1 agent'], ['agent', 6, '6 agents'], ['caractère', 1, '1 caractère'], ['caractère', 1240, '1240 caractères'],
      ['passage', 1, '1 passage'], ['passage', 3, '3 passages'], ['illisible', 1, '1 illisible'], ['illisible', 2, '2 illisibles'],
    ];
    for (const [mot, n, attendu] of cas) assert.equal(compte(n, mot), attendu);
  });
});

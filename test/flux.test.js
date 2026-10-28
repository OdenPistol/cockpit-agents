import assert from 'node:assert/strict';
import os from 'node:os';
import { describe, it } from 'node:test';
import { FormateurFlux } from '../src/flux.js';

const racine = '/projets/cockpit-agents';
const home = os.homedir();
const formateur = () => new FormateurFlux({ racine, home });
const outil = (nom, entree, id = 'toolu_1') => ({
  type: 'assistant', message: { content: [{ type: 'tool_use', id, name: nom, input: entree }] },
});
const texte = (lignes) => lignes.map((l) => l.texte);

describe('lignes lisibles à partir du flux stream-json', () => {
  it('annonce chaque outil par une phrase courte, avec des chemins relatifs au projet', () => {
    const f = formateur();
    assert.deepEqual(texte(f.traiter(outil('Read', { file_path: `${racine}/data/veille/sources.md` }))), ['Lit data/veille/sources.md']);
    assert.deepEqual(texte(f.traiter(outil('Write', { file_path: `${racine}/out/veille/resume.md`, content: 'a'.repeat(1240) }))), ['Écrit out/veille/resume.md (1240 caractères)']);
    assert.deepEqual(texte(f.traiter(outil('Edit', { file_path: `${racine}/out/x.md` }))), ['Modifie out/x.md']);
    assert.deepEqual(texte(f.traiter(outil('Glob', { pattern: '*.md', path: `${racine}/data` }))), ['Cherche les fichiers « *.md » dans data']);
    assert.deepEqual(texte(f.traiter(outil('Grep', { pattern: 'facture' }))), ['Cherche « facture »']);
    assert.deepEqual(texte(f.traiter(outil('WebFetch', { url: 'https://example.org/a' }))), ['Ouvre la page https://example.org/a']);
    assert.deepEqual(texte(f.traiter(outil('Bash', { command: 'ls -la' }))), ['Lance une commande : ls -la']);
    assert.deepEqual(texte(f.traiter(outil('OutilInconnu', {}))), ['Utilise l\'outil OutilInconnu']);
  });

  it('lit un chemin relatif depuis le dossier de travail de l\'agent : « ../../data » devient « data »', () => {
    const f = new FormateurFlux({ racine, home, cwd: `${racine}/agents/securite` });
    assert.deepEqual(texte(f.traiter(outil('Grep', { pattern: 'jeton', path: '../../data' }))), ['Cherche « jeton » dans data']);
    assert.deepEqual(texte(f.traiter(outil('Glob', { pattern: '*/agent.md', path: '../../agents' }, 'toolu_2'))), ['Cherche les fichiers « */agent.md » dans agents']);
    assert.deepEqual(texte(f.traiter(outil('Read', { file_path: `${racine}/data/a.md` }, 'toolu_3'))), ['Lit data/a.md']);
    // le texte de Claude n'est pas un chemin : il reste tel quel, même s'il contient des « / » et des « .. »
    const reponse = { type: 'assistant', message: { content: [{ type: 'text', text: '4 secrets, dans `data/divers/`\n../../out/securite/s.md' }] } };
    assert.deepEqual(texte(f.traiter(reponse)), ['Claude répond « 4 secrets, dans `data/divers/` ../../out/securite/s.md »']);
  });

  it('masque le dossier personnel de l\'utilisateur', () => {
    const f = formateur();
    const [ligne] = f.traiter(outil('Read', { file_path: `${home}/Documents/notes.md` }));
    assert.equal(ligne.texte, 'Lit ~/Documents/notes.md');
    assert.ok(!ligne.texte.includes(home));
  });

  it('résume ce que dit Claude sur une seule ligne, tronquée', () => {
    const f = formateur();
    const [ligne] = f.traiter({ type: 'assistant', message: { content: [{ type: 'text', text: `Voici\n\nle bilan.\n${'mot '.repeat(200)}` }] } });
    assert.equal(ligne.niveau, 'texte');
    assert.match(ligne.texte, /^Claude répond « Voici le bilan\. mot mot/);
    assert.ok(ligne.texte.endsWith(' »'));
    assert.ok(ligne.texte.length <= 330);
    assert.ok(!ligne.texte.includes('\n'));
  });

  it('annonce le démarrage et mémorise l\'événement init', () => {
    const f = formateur();
    const lignes = f.traiter({ type: 'system', subtype: 'init', claude_code_version: '2.1.306', model: 'claude-sonnet-5-5', tools: ['Read', 'Write'], apiKeySource: 'none' });
    assert.equal(lignes[0].texte, 'Claude Code 2.1.306 démarré · modèle claude-sonnet-5-5 · 2 outils');
    assert.equal(f.init.apiKeySource, 'none');
  });

  it('accorde le nombre d\'outils : 0 outil, 1 outil, 2 outils', () => {
    const init = (tools) => formateur().traiter({ type: 'system', subtype: 'init', claude_code_version: '2.1.306', model: 'm', tools })[0].texte;
    assert.equal(init([]), 'Claude Code 2.1.306 démarré · modèle m · 0 outil');
    assert.equal(init(['Read']), 'Claude Code 2.1.306 démarré · modèle m · 1 outil');
    assert.equal(init(['Read', 'Write']), 'Claude Code 2.1.306 démarré · modèle m · 2 outils');
    assert.equal(init(['Read', 'Write', 'Glob', 'Grep']), 'Claude Code 2.1.306 démarré · modèle m · 4 outils');
    assert.equal(formateur().traiter({ type: 'system', subtype: 'init', model: 'm' })[0].texte, 'Claude Code démarré · modèle m · 0 outil', 'liste absente');
  });

  it('accorde le nombre de caractères écrits : 1 caractère, 2 caractères', () => {
    const ecrit = (contenu) => formateur().traiter(outil('Write', { file_path: `${racine}/out/a.md`, content: contenu }))[0].texte;
    assert.equal(ecrit(''), 'Écrit out/a.md (0 caractère)');
    assert.equal(ecrit('a'), 'Écrit out/a.md (1 caractère)');
    assert.equal(ecrit('ab'), 'Écrit out/a.md (2 caractères)');
  });

  it('dit « Réfléchit… » une seule fois par silence', () => {
    const f = formateur();
    assert.equal(f.traiter({ type: 'system', subtype: 'thinking_tokens' }).length, 1);
    assert.equal(f.traiter({ type: 'system', subtype: 'thinking_tokens' }).length, 0);
    f.traiter(outil('Read', { file_path: 'a' }));
    assert.equal(f.traiter({ type: 'system', subtype: 'thinking_tokens' }).length, 1);
  });

  it('traduit un refus de permission en phrase claire', () => {
    const f = formateur();
    f.traiter(outil('Write', { file_path: `${racine}/out/autre/intrus.txt`, content: 'x' }, 'toolu_9'));
    const lignes = f.traiter({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: 'Permission to use Write has been denied because Claude Code is running in don\'t ask mode.' }] },
    });
    assert.deepEqual(texte(lignes), ['Refusé : rien n\'a été écrit dans out/autre/intrus.txt, hors du dossier de sortie de l\'agent']);
    assert.equal(lignes[0].niveau, 'erreur');
  });

  it('signale une autre erreur d\'outil, sans afficher de JSON', () => {
    const f = formateur();
    f.traiter(outil('Read', { file_path: 'x' }, 'toolu_4'));
    const lignes = f.traiter({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_4', is_error: true, content: [{ type: 'text', text: 'File does not exist.' }] }] },
    });
    assert.deepEqual(texte(lignes), ['Erreur de l\'outil Read : file does not exist.']);
  });

  it('un retour d\'outil réussi ne produit pas de ligne (l\'action a déjà été annoncée)', () => {
    const f = formateur();
    f.traiter(outil('Read', { file_path: 'x' }, 'toolu_5'));
    assert.deepEqual(f.traiter({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_5', content: 'contenu' }] } }), []);
  });

  it('mémorise le résultat final sans l\'afficher', () => {
    const f = formateur();
    assert.deepEqual(f.traiter({ type: 'result', subtype: 'success', total_cost_usd: 0.02, num_turns: 3 }), []);
    assert.equal(f.resultat.total_cost_usd, 0.02);
  });

  it('signale les nouvelles tentatives et la limite d\'usage atteinte', () => {
    const f = formateur();
    assert.match(f.traiter({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5, error: 'overloaded' })[0].texte, /Nouvelle tentative \(2\/5\).*overloaded/);
    assert.equal(f.traiter({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }).length, 0);
    assert.match(f.traiter({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })[0].texte, /Limite d'usage atteinte/);
  });

  it('ignore sans broncher les événements inconnus, les valeurs absurdes et les blocs vides', () => {
    const f = formateur();
    for (const e of [null, 42, 'texte', {}, { type: 'nouveau_type_futur', x: 1 }, { type: 'assistant' }, { type: 'assistant', message: { content: 'pas une liste' } },
      { type: 'user', message: { content: [{ type: 'image' }] } }, { type: 'system', subtype: 'inconnu' }, { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '   ' }] } }]) {
      assert.deepEqual(f.traiter(e), []);
    }
  });

  it('aucune ligne produite ne ressemble à du JSON brut', () => {
    const f = formateur();
    const evenements = [
      { type: 'system', subtype: 'init', claude_code_version: '2.1.306', model: 'm', tools: [] },
      outil('Read', { file_path: `${racine}/a.md` }),
      outil('Write', { file_path: `${racine}/out/b.md`, content: 'x' }, 'toolu_2'),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Fini.' }] } },
    ];
    for (const e of evenements) {
      for (const l of f.traiter(e)) assert.ok(!/^[{[]|"type"\s*:/.test(l.texte), l.texte);
    }
  });
});

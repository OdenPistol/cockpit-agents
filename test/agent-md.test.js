import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AgentMdError, chargerAgents, lireAgentMd, nomOutil } from '../src/agent-md.js';
import { agentMd, creerProjet, nettoyer } from './aide.js';

describe('lireAgentMd : cas nominal', () => {
  it('lit tous les champs et la consigne', () => {
    const agent = lireAgentMd(agentMd({ nom: 'Veille', planning: '07:30', budget: 0.5, tours: 10, prompt: 'Lis les sources.\n\nEt résume.' }), 'veille');
    assert.deepEqual(agent, {
      id: 'veille',
      nom: 'Veille',
      description: 'Un agent pour les tests.',
      planning: '07:30',
      budget_jour_eur: 0.5,
      outils: ['Read', 'Write', 'Glob', 'Grep'],
      max_tours: 10,
      prompt: 'Lis les sources.\n\nEt résume.',
    });
  });

  it('le planning est facultatif', () => {
    assert.equal(lireAgentMd(agentMd(), 'alpha').planning, null);
  });

  it('normalise l\'heure, accepte la virgule décimale, les guillemets et les commentaires', () => {
    const texte = [
      '---',
      '# une remarque pour les humains',
      'nom: "Boîte mail"',
      'description: \'Trie les messages\'',
      'planning: 7:05',
      'budget_jour_eur: 0,75   # en euros',
      'outils: [Read, "Write"]',
      'max_tours: 12',
      '---',
      'Consigne.',
    ].join('\n');
    const agent = lireAgentMd(texte, 'boite-mail');
    assert.equal(agent.nom, 'Boîte mail');
    assert.equal(agent.description, 'Trie les messages');
    assert.equal(agent.planning, '07:05');
    assert.equal(agent.budget_jour_eur, 0.75);
    assert.deepEqual(agent.outils, ['Read', 'Write']);
  });

  it('ne coupe pas une liste d\'outils à l\'intérieur des parenthèses', () => {
    const agent = lireAgentMd(agentMd({ outils: 'Read, Bash(git log *, git diff *), WebFetch(domain:example.org)' }), 'alpha');
    assert.deepEqual(agent.outils, ['Read', 'Bash(git log *, git diff *)', 'WebFetch(domain:example.org)']);
    assert.equal(nomOutil('Bash(git log *, git diff *)'), 'Bash');
  });

  it('supporte les fins de ligne Windows et le BOM', () => {
    const texte = `﻿${agentMd().replace(/\n/g, '\r\n')}`;
    assert.equal(lireAgentMd(texte, 'alpha').nom, 'Agent de test');
  });

  it('transmet la consigne telle quelle (sans toucher au contenu)', () => {
    const prompt = '# Titre\n\n- point `code`\n\n```\nbloc\n```';
    assert.equal(lireAgentMd(agentMd({ prompt }), 'alpha').prompt, prompt);
  });
});

describe('lireAgentMd : en-tête invalide', () => {
  const cas = [
    ['pas de ligne --- au début', 'nom: X\n---\nprompt', /commencer par une ligne « --- »/],
    ['en-tête non fermé', '---\nnom: X\ndescription: Y\n', /pas fermé/],
    ['clé obligatoire absente', agentMd().replace(/^budget_jour_eur:.*\n/m, ''), /« budget_jour_eur » est obligatoire/],
    ['clé inconnue (faute de frappe)', agentMd().replace('budget_jour_eur', 'budget'), /clé inconnue « budget »/],
    ['clé en double', agentMd().replace('max_tours: 5', 'max_tours: 5\nmax_tours: 6'), /écrite deux fois/],
    ['ligne illisible', agentMd().replace('nom: Agent de test', 'ceci n\'est pas une clé'), /illisible/],
    ['planning mal écrit', agentMd({ planning: '7h30' }), /HH:MM/],
    ['planning hors limites', agentMd({ planning: '25:00' }), /HH:MM/],
    ['budget négatif', agentMd({ budget: -1 }), /nombre d'euros positif/],
    ['budget illisible', agentMd({ budget: 'beaucoup' }), /nombre d'euros positif/],
    ['max_tours décimal', agentMd({ tours: '2.5' }), /entier entre 1 et 100/],
    ['max_tours nul', agentMd({ tours: 0 }), /entier entre 1 et 100/],
    ['outil MCP', agentMd({ outils: 'Read, mcp__gmail__send' }), /MCP ne sont pas pris en charge/],
    ['nom d\'outil en minuscules', agentMd({ outils: 'read' }), /pas un nom d'outil valide/],
    ['parenthèse non fermée', agentMd({ outils: 'Bash(ls' }), /parenthèse non fermée/],
    ['consigne vide', agentMd({ prompt: '' }), /consigne.*vide/],
  ];
  for (const [titre, texte, motif] of cas) {
    it(titre, () => {
      assert.throws(() => lireAgentMd(texte, 'alpha'), (e) => e instanceof AgentMdError && motif.test(e.message));
    });
  }

  it('refuse un nom de dossier qui ne convient pas', () => {
    assert.throws(() => lireAgentMd(agentMd(), 'Mon Agent'), /minuscules, chiffres et tirets/);
  });
});

describe('WebFetch : toujours avec un domaine', () => {
  it('« WebFetch » seul est refusé, avec un message qui dit quoi écrire à la place', () => {
    for (const outils of ['WebFetch', 'Read, WebFetch', 'WebFetch, Read, Write', '[Read, "WebFetch"]']) {
      assert.throws(() => lireAgentMd(agentMd({ outils }), 'alpha'), (e) => {
        assert.ok(e instanceof AgentMdError);
        assert.match(e.message, /« WebFetch » seul laisserait l'agent ouvrir n'importe quelle page du web/);
        assert.match(e.message, /écris « WebFetch\(domain:example\.org\) », un domaine par site de confiance/);
        return true;
      }, outils);
    }
  });

  it('« WebFetch(domain:…) » est accepté, un domaine par entrée, tel quel', () => {
    const un = lireAgentMd(agentMd({ outils: 'Read, WebFetch(domain:example.org)' }), 'alpha');
    assert.deepEqual(un.outils, ['Read', 'WebFetch(domain:example.org)']);
    const deux = lireAgentMd(agentMd({ outils: 'WebFetch(domain:example.org), WebFetch(domain:blog.example.org), Write' }), 'alpha');
    assert.deepEqual(deux.outils, ['WebFetch(domain:example.org)', 'WebFetch(domain:blog.example.org)', 'Write']);
    assert.equal(nomOutil('WebFetch(domain:example.org)'), 'WebFetch');
    assert.deepEqual(lireAgentMd(agentMd({ outils: 'WebFetch(domain:xn--exemple-9ua.org)' }), 'alpha').outils, ['WebFetch(domain:xn--exemple-9ua.org)']);
  });

  it('les formes qui ouvriraient trop (ou qui ne marcheraient pas) sont refusées avec le même exemple', () => {
    const douteuses = [
      'WebFetch()', 'WebFetch(*)', 'WebFetch(domain:*)', 'WebFetch(domain:)', 'WebFetch(domain:*.example.org)',
      'WebFetch(domain:https://example.org)', 'WebFetch(domain:example.org/page)', 'WebFetch(domain:example.org:8080)',
      'WebFetch(domain: example.org)', 'WebFetch(domain:a b)', 'WebFetch(Domain:example.org)', 'WebFetch(example.org)',
      'WebFetch(domain:-example.org)', 'WebFetch(domain:example..org)',
    ];
    for (const entree of douteuses) {
      assert.throws(() => lireAgentMd(agentMd({ outils: `Read, ${entree}` }), 'alpha'), (e) => {
        assert.ok(e instanceof AgentMdError, entree);
        assert.ok(e.message.includes(`« ${entree} » n'est pas valable`), `${entree} : ${e.message}`);
        assert.match(e.message, /WebFetch\(domain:example\.org\)/);
        return true;
      }, entree);
    }
  });

  it('les autres outils ne sont pas touchés (Bash et Read avec un motif passent comme avant)', () => {
    const agent = lireAgentMd(agentMd({ outils: 'Read(//usr/share/doc/**), Bash(ls *), Glob' }), 'alpha');
    assert.deepEqual(agent.outils, ['Read(//usr/share/doc/**)', 'Bash(ls *)', 'Glob']);
  });

  it('un agent avec « WebFetch » seul est isolé dans « invalides » : les autres tournent, l\'écran dit pourquoi', () => {
    const racine = creerProjet({
      bon: agentMd({ nom: 'Bon' }),
      veille: agentMd({ nom: 'Veille', outils: 'Read, WebFetch' }),
    });
    try {
      const { agents, invalides } = chargerAgents(racine, []);
      assert.deepEqual(agents.map((a) => a.id), ['bon']);
      assert.equal(invalides.length, 1);
      assert.equal(invalides[0].id, 'veille');
      assert.match(invalides[0].erreur, /« WebFetch » seul laisserait l'agent ouvrir n'importe quelle page du web/);
    } finally {
      nettoyer(racine);
    }
  });
});

describe('chargerAgents', () => {
  it('lit les dossiers, applique l\'ordre, et isole un agent cassé', () => {
    const racine = creerProjet({
      zeta: agentMd({ nom: 'Zeta' }),
      alpha: agentMd({ nom: 'Alpha' }),
      cassé: 'pas un agent',
      'mal-ecrit': agentMd({ budget: 'x' }),
    });
    try {
      fs.mkdirSync(path.join(racine, 'agents', 'sans-fichier'));
      fs.mkdirSync(path.join(racine, 'agents', '.cache'));
      const { agents, invalides } = chargerAgents(racine, ['zeta']);
      assert.deepEqual(agents.map((a) => a.id), ['zeta', 'alpha']);
      assert.deepEqual(invalides.map((i) => i.id).sort(), ['cassé', 'mal-ecrit', 'sans-fichier']);
      assert.match(invalides.find((i) => i.id === 'sans-fichier').erreur, /agent\.md est introuvable/);
    } finally {
      nettoyer(racine);
    }
  });

  it('un dossier ajouté après coup apparaît au chargement suivant (ajouter un agent = créer un dossier)', () => {
    const racine = creerProjet({ alpha: agentMd() });
    try {
      assert.equal(chargerAgents(racine).agents.length, 1);
      fs.mkdirSync(path.join(racine, 'agents', 'nouveau'));
      fs.writeFileSync(path.join(racine, 'agents', 'nouveau', 'agent.md'), agentMd({ nom: 'Nouveau' }));
      assert.deepEqual(chargerAgents(racine).agents.map((a) => a.nom), ['Agent de test', 'Nouveau']);
    } finally {
      nettoyer(racine);
    }
  });

  it('un projet sans dossier agents/ donne une liste vide', () => {
    const racine = creerProjet({});
    try {
      assert.deepEqual(chargerAgents(racine), { agents: [], invalides: [] });
    } finally {
      nettoyer(racine);
    }
  });
});

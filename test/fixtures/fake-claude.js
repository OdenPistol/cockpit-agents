#!/usr/bin/env node
// Faux « claude » pour les tests : rejoue un flux stream-json réaliste, sans appeler aucun service.
// Le scénario se choisit avec la variable FAKE_CLAUDE :
//   reussi (défaut)  lit un fichier, écrit out/<agent>/resultat.md, répond, coûte FAKE_COUT dollars
//   lent             comme reussi, avec une pause entre les événements (pour tester le direct)
//   echec            se termine par une erreur d'exécution
//   max_tours        se termine par error_max_turns
//   refus            une écriture est refusée par les permissions
//   sans_result      s'arrête brutalement, sans événement « result »
//   silence          ne dit plus rien (pour tester le délai maximal)
// FAKE_OUTILS (liste séparée par des virgules) et FAKE_TOURS fixent les outils annoncés et le nombre de tours du succès.
// Si FAKE_ARGS_FILE est défini, les arguments, l'environnement utile et la consigne reçue y sont écrits.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const scenario = process.env.FAKE_CLAUDE ?? 'reussi';

if (args[0] === '--version') {
  console.log('2.1.999 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (scenario === 'deconnecte') {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ loggedIn: true, authMethod: process.env.FAKE_AUTH ?? 'claude.ai' }));
  process.exit(0);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const emettre = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

let prompt = '';
process.stdin.setEncoding('utf8');
for await (const morceau of process.stdin) prompt += morceau;

if (process.env.FAKE_ARGS_FILE) {
  fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({
    args,
    cwd: process.cwd(),
    prompt,
    env: {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null,
    },
  }));
}

const idAgent = path.basename(process.cwd());
const pause = scenario === 'lent' ? 250 : 0;
const cout = Number(process.env.FAKE_COUT ?? 0.05);
const session = '00000000-0000-4000-8000-000000000000';

emettre({
  type: 'system', subtype: 'init', cwd: process.cwd(), session_id: session,
  tools: process.env.FAKE_OUTILS === undefined ? ['Glob', 'Grep', 'Read', 'Write'] : process.env.FAKE_OUTILS.split(',').filter(Boolean), mcp_servers: [], model: 'claude-fake-1', permissionMode: 'dontAsk',
  apiKeySource: 'none', claude_code_version: '2.1.999',
});

if (scenario === 'silence') {
  await attendre(60000);
  process.exit(0);
}
if (scenario === 'sans_result') {
  process.stderr.write('Boum : panne simulée\n');
  process.exit(3);
}

await attendre(pause);
emettre({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, session_id: session });
await attendre(pause);
emettre({
  type: 'assistant',
  message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: path.resolve(process.cwd(), '../../data/lisez-moi.txt') } }] },
});
await attendre(pause);
emettre({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1\tbonjour' }] } });

if (scenario === 'refus') {
  await attendre(pause);
  emettre({
    type: 'assistant',
    message: { id: 'msg_2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/ailleurs/intrus.txt', content: 'x' } }] },
  });
  emettre({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'Permission to use Write has been denied because Claude Code is running in don\'t ask mode.' }] },
  });
}

if (scenario === 'echec' || scenario === 'max_tours') {
  emettre({
    type: 'result', subtype: scenario === 'echec' ? 'error_during_execution' : 'error_max_turns', is_error: true,
    duration_ms: 800, duration_api_ms: 700, num_turns: scenario === 'echec' ? 1 : 3, session_id: session,
    total_cost_usd: cout, usage: {}, modelUsage: {}, permission_denials: [], errors: ['panne simulée'],
  });
  process.exit(1);
}

const sortie = path.resolve(process.cwd(), '../../out', idAgent, 'resultat.md');
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, `# Résultat simulé de ${idAgent}\n`);
await attendre(pause);
emettre({
  type: 'assistant',
  message: { id: 'msg_3', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_3', name: 'Write', input: { file_path: sortie, content: `# Résultat simulé de ${idAgent}\n` } }] },
});
emettre({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: 'File created successfully' }] } });
await attendre(pause);
emettre({ type: 'assistant', message: { id: 'msg_4', role: 'assistant', content: [{ type: 'text', text: 'Terminé.\n\nLe résultat est écrit.' }] } });
emettre({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, duration_api_ms: 1000, num_turns: Number(process.env.FAKE_TOURS ?? 3),
  result: 'Terminé.', session_id: session, total_cost_usd: cout, usage: {}, modelUsage: {}, permission_denials: [],
});

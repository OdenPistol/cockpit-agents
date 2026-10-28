// Le cœur de `npm run essai` : lance chaque agent une fois, à la suite, et affiche le coût total réel.
// Sert à produire un vrai historique avant un tournage ou une démonstration.
// Les budgets sont respectés exactement comme depuis l'écran : un agent que son budget refuserait est signalé
// et sauté, sans ligne de journal (l'essai ne laisse pas d'alerte pour la journée ; le refus se verra au premier clic).

import { Cockpit } from './cockpit.js';
import { chargerConfig, ConfigError } from './config.js';
import { verifierBudget } from './cout.js';
import { estAbonnement } from './etat.js';
import { arrondir, compte, duree, eur } from './utilitaires.js';

const virgule = (n) => String(n).replace('.', ',');
const coutTexte = (r) => (typeof r.cout_eur === 'number' ? eur(r.cout_eur, 3) : 'coût inconnu');

/**
 * Lance chaque agent une fois, dans l'ordre de config.json.
 * @param {{racine:string, config?:object, afficher?:(texte:string)=>void}} p
 * @returns {Promise<{code:number, resultats:object[], total_eur:number}>}
 */
export async function essai({ racine, config = null, afficher = console.log }) {
  if (config === null) {
    try {
      config = chargerConfig(racine);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      afficher(`\n✖ ${e.message}\n`);
      return { code: 1, resultats: [], total_eur: 0 };
    }
  }

  const cockpit = new Cockpit({ racine, config });
  const claude = await cockpit.initialiser();
  if (!claude.ok) {
    afficher(`\n✖ ${claude.erreur}\n`);
    return { code: 1, resultats: [], total_eur: 0 };
  }
  if (claude.connecte === false) {
    afficher('\n✖ Claude Code n\'est pas connecté à un compte. Tape « claude auth login », puis relance l\'essai.\n');
    return { code: 1, resultats: [], total_eur: 0 };
  }

  const { agents, invalides } = cockpit.agents();
  for (const i of invalides) afficher(`⚠ Agent « ${i.id} » ignoré : ${i.erreur}`);
  afficher(`\nEssai : ${compte(agents.length, 'agent')}, un passage chacun, à la suite (Claude Code ${claude.version}).`);

  let agentCourant = null;
  cockpit.on('ligne', (l) => {
    if (l.agent === agentCourant) afficher(`    ${l.ts.slice(11, 19)}  ${l.texte}`);
  });

  const resultats = [];
  for (const agent of agents) {
    agentCourant = agent.id;
    afficher(`\n▶ ${agent.nom}`);
    const verdict = verifierBudget({ entrees: cockpit.entrees(), agent, config, maintenant: cockpit.maintenant() });
    if (!verdict.ok) {
      afficher(`    ✖ ${verdict.message}`);
      afficher('    Sauté, sans ligne de journal : son refus se verra au premier clic sur « Lancer ».');
      resultats.push({ agent_nom: agent.nom, statut: 'refuse', cout_usd: 0, cout_eur: 0, duree_ms: null, tours: null, resultat: null });
      continue;
    }
    const lancement = cockpit.lancer(agent.id, 'essai');
    if (!lancement.ok) {
      afficher(`    ✖ ${lancement.message}`);
      resultats.push({ agent_nom: agent.nom, statut: 'refuse', cout_usd: 0, cout_eur: 0, duree_ms: null, tours: null, resultat: null });
      continue;
    }
    resultats.push(await lancement.promesse);
  }
  agentCourant = null;

  afficher('\nRésumé');
  afficher('  Agent               Statut    Durée       Tours  Coût');
  let total = 0;
  let totalUsd = 0;
  let inconnus = 0;
  let estime = 0;
  for (const r of resultats) {
    if (typeof r.cout_eur === 'number') total += r.cout_eur;
    else if (r.statut !== 'refuse') {
      inconnus += 1;
      estime += r.cout_estime_eur ?? 0;
    }
    if (typeof r.cout_usd === 'number') totalUsd += r.cout_usd;
    afficher(`  ${r.agent_nom.padEnd(19)} ${String(r.statut).padEnd(9)} ${(r.duree_ms === null ? '' : duree(r.duree_ms)).padEnd(11)} ${String(r.tours ?? '').padEnd(6)} ${coutTexte(r)}${r.resultat ? `   → ${r.resultat}` : ''}`);
  }
  total = arrondir(total, 6);
  afficher(`\nCoût total réel de l'essai : ${eur(total, 3)} (${virgule(totalUsd.toFixed(4))} $ au taux de ${virgule(config.taux_usd_eur)} € pour 1 $)`);
  if (inconnus > 0) {
    const verbe = inconnus >= 2 ? 'ne sont pas' : 'n\'est pas';
    afficher(`${compte(inconnus, 'passage')} au coût inconnu ${verbe} dans ce total : le budget du jour compte à la place une estimation prudente de ${eur(arrondir(estime, 6), 3)}.`);
  }
  if (estAbonnement(config, claude)) {
    afficher('Tu es connecté par abonnement : ce montant est un équivalent API, pas une facture supplémentaire.');
  }
  afficher('Ouvre le cockpit (npm start) : ces passages apparaissent dans l\'historique.\n');

  return { code: resultats.every((r) => r.statut === 'reussi') ? 0 : 1, resultats, total_eur: total };
}

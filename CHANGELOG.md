# Changelog

Chaque vidéo « build in public » enrichit ce cockpit. Les versions sont datées, la plus récente en haut. Quand une version est publiée, le README la signale par une section « Nouvelle version ».

## 1.1.0 (date à remplir à la publication) : l'agent Juge

Vidéo n° 2 : comment s'assurer qu'un agent ne rend pas n'importe quoi.

Ajouté
- Un agent **Juge** (`agents/juge/`), un agent comme les autres : outils Read et Write seulement, un budget de 0,40 € par jour, 10 étapes au plus, configuration isolée. Il compare la sortie d'un autre agent à ses critères et écrit un verdict dans `out/juge/` : ACCEPTÉ ou REJETÉ, avec des corrections numérotées et leur preuve. Il ne corrige jamais ce qu'il juge.
- Une **definition of done** par agent vérifié : un fichier `dod.md` dans le dossier de l'agent, trois à cinq critères vérifiables. Celle de Factures est livrée (`agents/factures/dod.md`). Guide : `docs/ecrire-une-dod.md`.
- À l'écran, sous l'agent vérifié : « Vérifié par le Juge : accepté » ou « Rejeté : 2 corrections », avec un clic qui ouvre le verdict (score, critères, corrections et preuves), le bouton « Lancer le Juge » et, après un rejet, « Relancer avec les corrections ».
- Le cockpit lit le verdict par machine et le refuse s'il est mal formé ou contradictoire : un verdict illisible n'est jamais pris pour un accord. Un verdict ne vaut que pour la sortie qu'il juge.
- Une erreur plantée exprès dans les données de démonstration, comme l'email piégé de la première vidéo : le total TTC de la facture F-2026-0079 est faux dans `data/factures/factures.csv`. Le Juge doit l'attraper.
- Deux routes locales, avec les mêmes protections que « Lancer » : `POST /api/agents/<id>/verifier` et `POST /api/agents/<id>/relancer-avec-corrections`. Un « Lancer » sur la ligne du Juge (`POST /api/agents/juge/lancer`) fait vérifier le premier agent dont la sortie attend un verdict.

Modifié
- La démo compte 10 agents. Le Juge est placé sous Factures dans `config.json`.
- Le coût du Juge compte dans son budget et dans le plafond du jour, comme celui des autres agents.
- `npm run essai` ne lance pas le Juge (il vérifie le travail d'un autre agent, au clic) : les chiffres de l'essai ne changent pas.

Rien d'automatique : le Juge ne se lance qu'au clic (une heure `planning` dans son `agent.md` le fait écarter), et un rejet attend la décision de la personne, « Relancer avec les corrections » ou rien.

## 1.0.0 (28/10/2026) : le cockpit d'agents

Vidéo n° 1. Un cockpit local qui lance des agents Claude Code : journal en direct, coût du jour, budgets, alertes. Neuf agents d'exemple qui travaillent sur des données fictives.

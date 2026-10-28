# Cockpit d'agents

Un tableau de bord **local** pour lancer des agents Claude Code, voir ce qu'ils font en direct, ce qu'ils coûtent aujourd'hui et être prévenu quand quelque chose cloche. Démo libre (MIT), données **fictives**.

**Le cockpit est gratuit, mais Claude Code ne l'est pas** : il faut un abonnement Claude payant ou une clé API facturée à l'usage. Faire tourner une fois les huit agents que `npm run essai` lance a coûté 0,495 € le 28/10/2026 et 0,577 € le 21/10/2026, en équivalent API.

![Le cockpit d'agents](captures/cockpit.png)

## Ce qu'il vous faut

- **Node.js 22 ou plus** : tapez `node --version` dans le Terminal. Si le numéro est plus petit, ou si la commande échoue, installez la dernière version sur nodejs.org.
- **Claude Code**, installé (code.claude.com/docs/en/setup) et connecté : `claude auth status` doit dire que vous êtes connecté. Si votre version est trop ancienne, tapez `claude update`.

## Installer et lancer

1. Récupérez le dossier : sur la page du projet, bouton « Code » puis « Download ZIP », et décompressez l'archive (ou `git clone` si vous connaissez).
2. Ouvrez l'application Terminal. Tapez `cd` suivi d'une espace, glissez le dossier du cockpit dans la fenêtre du Terminal, puis appuyez sur Entrée.
3. Tapez la commande suivante, puis appuyez sur Entrée :

```
npm start
```

Le cockpit s'ouvre dans votre navigateur sur http://127.0.0.1:4321 (c'est aussi `localhost:4321`). Pour l'arrêter, appuyez sur `Ctrl+C` dans le Terminal. Il n'y a rien à installer : le cockpit n'a aucune dépendance.

Pour lancer tous les agents une fois chacun et voir l'estimation de leur coût total (un agent que son budget refuserait est sauté, sans alerte) :

```
npm run essai
```

Pour vérifier le code, sans appeler Claude :

```
npm test
```

Si vous ouvrez le cockpit après 07:00, des alertes « en retard » apparaissent et disent pourquoi (le cockpit n'était pas lancé à cette heure) : c'est voulu, Sécurité, Veille, Avis clients et Rapport du matin ont une heure prévue, de 07:00 à 08:00. Lancez-les à la main, ou retirez la ligne `planning` de leur `agent.md`.

## Les 9 agents

| Agent | Ce qu'il fait | Il écrit dans |
|---|---|---|
| Veille | résume 6 extraits d'actualité IA | `out/veille/` |
| Sécurité | relève les outils de chaque agent (alerte sur Bash ou un accès web sans domaine) et cherche les secrets écrits en clair dans `data/`, sans jamais recopier leur valeur | `out/securite/` |
| Boîte mail | trie 50 emails, repère ceux qui cachent une consigne pour l'IA, prépare 3 brouillons | `out/boite-mail/` |
| Factures | liste les impayés de plus de 30 jours, prépare les relances | `out/factures/` |
| Devis | prépare un brouillon de devis par demande, avec la grille de prix seulement | `out/devis/` |
| Avis clients | prépare une réponse par avis, met de côté les avis suspects | `out/avis/` |
| Relances prospects | prépare une relance par prospect sans réponse depuis plus de 7 jours, dit pourquoi les autres sont laissés tranquilles | `out/prospects/` |
| Contenu | transforme vos notes en brouillon de post (et 3 idées de titres) | `out/contenu/` |
| Rapport du matin | lit les sorties des autres, écrit un point de 10 lignes | `out/rapport-du-matin/` |

Ils lisent `data/` (fictif) et **n'envoient jamais rien**. Les secrets de `data/divers/` sont faux : ils sont là pour que Sécurité ait quelque chose à trouver. Relances prospects a un budget de 0,10 € : il est refusé tant que vous ne le relevez pas, c'est la démonstration du refus. Exemples de sorties : `docs/exemples-de-sorties/`. Pour une veille sur le vrai web : ajoutez `WebFetch(domain:example.org)` à `outils` dans `agents/veille/agent.md`, un domaine par site de confiance (le cockpit refuse `WebFetch` seul, qui ouvrirait n'importe quelle page), et vos liens dans `data/veille/sources.md`.

## Ajouter un agent

Créez `agents/mon-agent/agent.md`, puis rechargez la page :

```
---
nom: Mon agent
description: Ce qu'il fait, en une ligne
planning: 09:00          # facultatif : l'heure où il se lance seul
budget_jour_eur: 0.50    # ce qu'il peut dépenser par jour
outils: Read, Write      # lire, écrire ; Glob et Grep pour chercher ; pas de Bash par défaut
max_tours: 8             # nombre maximal d'étapes de Claude
---
La consigne, en français : transmise telle quelle à Claude Code.
Il lit dans ../../data/ et n'écrit que dans ../../out/mon-agent/.
```

Après un passage réussi, l'écran affiche sous son nom ce qu'il a fait, en une ligne prise dans ce qu'il a écrit : la ligne « Bilan : … » de son fichier, ou la ligne de chiffres juste sous son titre (« 3 demandes · 3 devis »). Demandez-lui cette ligne dans sa consigne ; sans elle, l'écran reprend sa dernière réponse ou le début de son fichier.

Un clic sur la ligne d'un agent ouvre sa fiche : ce qu'il fait, quand il se lance (« Automatique à 07:30 » ou « Manuel »), son budget du jour, son dernier passage et son résultat, avec « Ouvrir le résultat » et « Lancer ». Échap ou la croix la ferment ; elle se ferme seule quand un passage démarre.

## Ce que coûte un passage

L'écran affiche l'**estimation** du coût renvoyée par Claude Code (`total_cost_usd`), convertie en euros avec `taux_usd_eur` (`config.json`). Mesuré le 21/10/2026 avec le modèle sonnet : de 0,041 € (Contenu) à 0,132 € (Boîte mail) par passage, **0,577 € les huit** (Relances prospects, dont le budget est sous l'estimation prudente, ne tourne pas). L'essai du 28/10/2026 a donné **0,495 € les huit**. `npm run essai` vous donne l'estimation chez vous. Sur abonnement, l'écran dit « équivalent API » : pas une facture en plus.
**Budgets** : si le coût du jour + une estimation prudente (le plus cher des 5 derniers passages, 0,15 € au début) dépasse le budget de l'agent ou le plafond du jour (`config.json`), l'agent ne se lance pas et une alerte s'affiche.
**Coût inconnu** : si Claude Code s'arrête sans donner son résultat (coupure, délai dépassé), l'écran écrit « coût inconnu » et le budget du jour compte à la place l'estimation prudente, pour qu'une coupure ne contourne pas le budget.

## Configuration isolée

Chaque agent tourne en **configuration isolée**, sans votre configuration personnelle (réglages, `CLAUDE.md`, mémoire, serveurs MCP, skills) : plus sûr (aucun accès à vos messageries), reproductible, moins cher. Mesuré sur une machine à la configuration chargée : 36 066 jetons au premier échange, contre 5 077. Pour revenir à la vôtre : `"configuration_isolee": false` dans `config.json`.

## Ce que l'outil ne fait pas

- Ni voix, ni vrais comptes (messagerie, banque), ni authentification, ni base de données.
- **Le coût d'un passage n'est connu qu'à la fin** : un passage en cours qui dépasse le plafond n'est pas coupé. Le budget protège le lancement suivant.
- **Le Mac doit être allumé** et le cockpit lancé. Sinon rien ne tourne à l'heure : l'alerte « en retard » le dit au retour, l'agent n'est pas lancé après coup.
- Les agents ne lisent que `data/`, `out/` et leur propre dossier, et n'écrivent que dans `out/<agent>/`. Un agent peut lire un autre dossier du projet si son `agent.md` le demande, chemin écrit depuis la racine du projet : Sécurité a `Read(agents/**)` pour lire les `agent.md` des autres, en lecture seule. Ajouter `Bash` à un agent lui permet d'exécuter n'importe quelle commande sur votre Mac sans vous demander : ne le faites que si vous savez pourquoi. `WebFetch` seul est refusé (il ouvrirait n'importe quelle page) : écrivez `WebFetch(domain:…)`, un domaine par site.
- Testé sur macOS seulement.

## Lancer au démarrage du Mac (launchd)

`exemples/cockpit-agents.plist` est un modèle, rien n'est installé d'office. Remplacez les `/CHEMIN/VERS/...` (réponses de `which node`, `pwd`, `which claude`), copiez-le dans `~/Library/LaunchAgents/`, puis `launchctl load ~/Library/LaunchAgents/cockpit-agents.plist` (`unload` pour arrêter). Mettez aussi le chemin complet de `claude` dans `commande_claude` (`config.json`).

## Ce qui a été vérifié (Claude Code 2.1.306, macOS, 21/10/2026)

- Lues dans la documentation officielle (code.claude.com/docs) et testées en réel : `-p --output-format stream-json --verbose`, `--max-turns` (absente de `claude --help`, mais acceptée), `--tools`, `--allowedTools`, `--permission-mode dontAsk`, `--add-dir`, `--setting-sources project`, `--settings`, `--strict-mcp-config`, `--disable-slash-commands`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- Un `CLAUDE.md` de dossier parent est chargé malgré `--setting-sources project` (écarté par `claudeMdExcludes`) ; sans `--strict-mcp-config`, les connecteurs du compte (messagerie, fichiers) sont chargés dans l'agent.
- Lecture et écriture : un `Read` nu dans `--allowedTools` laisse l'agent lire tout le disque, il n'y est donc jamais. Le mode `dontAsk` laisse lire le dossier de travail et les dossiers `--add-dir`, et refuse le reste (testé avec un fichier témoin hors du projet). Une règle de lecture relative, comme `Read(agents/**)`, n'est pas appliquée dans ce mode : le cockpit passe ce dossier par `--add-dir`, et ignore tout chemin qui sort du projet. L'écriture passe par `Edit(//…/out/<agent>/**)`.
- `--bare` est écartée (non testée) : elle ignore la connexion par abonnement. Le coût est lu (`total_cost_usd`), jamais recalculé, contrairement à l'outil libre `ccusage` (MIT) qui, sur les journaux locaux, prend le `costUSD` enregistré ou recalcule jetons × grille de prix.

# Comment écrire une bonne definition of done

Une definition of done (DoD) est la liste des critères qu'un travail doit respecter pour être accepté. Elle s'écrit **avant** le travail, jamais après avoir vu le résultat : sinon on règle les critères sur ce que l'agent a produit, et le Juge ne juge plus rien. Dans ce cockpit, c'est le fichier `agents/<agent>/dod.md`. Le Juge compare la sortie de l'agent à chaque critère, un par un.

## Les règles d'un bon critère

1. **Un critère se constate par oui ou non.** Le Juge doit pouvoir répondre « respecté » ou « pas respecté » en lisant la sortie et ses sources. « Le résultat est correct » ne se constate pas ; « le total annoncé est la somme des lignes du tableau » se constate.
2. **Il dit où regarder.** Nommez le fichier ou la donnée qui fait foi (`data/factures/factures.csv`), pour que le Juge refasse le calcul lui-même au lieu de croire le texte de la sortie.
3. **Il chiffre ses seuils et ses cas limites.** « Plus de 30 jours (31 jours ou plus) » vaut mieux que « en retard ».
4. **Il dit quoi faire quand les données se contredisent.** « Si le fichier se contredit, la sortie le signale au lieu de recopier le montant » : sans cela, aucun critère ne tranche.
5. **Il n'y en a pas trop.** Trois à cinq critères, dix au plus, un par numéro, chacun de 600 caractères au plus. Au-delà, la liste ne se relit plus et on ne sait plus ce qui compte.
6. **Il évite le goût.** « Le ton est agréable » n'a pas de preuve : le Juge peut se tromper et personne ne peut le vérifier. Gardez les critères objectifs ; ce qui relève du goût reste à relire par vous.

## Un critère faible, un critère fort

| Faible | Fort |
|---|---|
| Les montants sont justes. | Le montant TTC de chaque facture du tableau est égal à son montant HT plus sa TVA, d'après le fichier. |
| Aucun oubli. | Toute facture impayée de plus de 30 jours du fichier est dans le tableau, et les autres factures impayées sont nommées dans « Non concernées ». |
| Les relances sont bien faites. | Chaque brouillon donne le numéro, le montant TTC et la date d'échéance de sa facture, identiques à ceux du tableau. |

## Le format du fichier

Un titre, une phrase d'introduction si vous voulez, puis la liste numérotée : `1.`, `2.`, `3.`… à la suite, un critère par numéro (une suite indentée prolonge le critère). Tout le reste est ignoré. Voici celle de l'agent Factures, `agents/factures/dod.md` :

```
# Definition of done : Factures

Ces critères sont écrits avant le travail de l'agent. Le Juge compare sa sortie à chacun d'eux, un par un, et rend un verdict : accepté seulement si les cinq sont respectés.

1. Chaque facture du tableau « Impayés de plus de 30 jours » est impayée dans data/factures/factures.csv et a plus de 30 jours de retard à la date du titre de la sortie (31 jours ou plus).
2. Aucune facture n'est oubliée : toute facture impayée de plus de 30 jours du fichier est dans le tableau, et les autres factures impayées sont nommées dans « Non concernées ».
3. Le montant TTC de chaque facture du tableau est égal à son montant HT plus sa TVA, d'après le fichier. Si le fichier se contredit sur une facture, la sortie le signale au lieu de recopier le montant fautif.
4. Le total TTC annoncé est exactement la somme des montants TTC du tableau.
5. Chaque brouillon de relance donne le numéro, le montant TTC et la date d'échéance de sa facture, identiques à ceux du tableau.
```

Si le fichier n'a aucun critère numéroté, s'il en a plus de dix ou si les numéros sautent, le cockpit le dit sous l'agent (« Definition of done illisible ») et ne lance pas le Juge.

## Ce que le Juge en fait

Il juge le dernier fichier que l'agent a écrit : si votre agent produit plusieurs fichiers par passage, la definition of done doit porter sur celui-là. Pour chaque critère, il rend OK ou ÉCART. Il n'y a pas de note : un seul écart suffit pour que le verdict soit REJETÉ. Chaque écart donne au moins une correction numérotée, avec sa preuve : la ligne de la sortie qui pose problème, ce que dit la source, le calcul refait. Un critère qu'il n'a pas pu vérifier est un écart.

## Après un rejet

Lisez le verdict avant de relancer : une correction qui se répète d'un passage à l'autre vient presque toujours de la consigne de l'agent ou de ses données, pas du hasard. « Relancer avec les corrections » refait la sortie une fois ; corriger la consigne ou la donnée évite que l'erreur revienne.

Le Juge est un modèle : il peut se tromper, dans les deux sens. Une DoD précise réduit ce risque sans le supprimer, et ne remplace pas votre relecture de ce qui part chez un client.

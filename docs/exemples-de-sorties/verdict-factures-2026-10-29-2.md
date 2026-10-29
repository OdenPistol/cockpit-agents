# Verdict du Juge : Factures

Verdict : ACCEPTÉ
Agent vérifié : factures
Sortie jugée : ../../out/factures/relances-2026-10-29.md
Bilan : Factures accepté, 5 critères sur 5.

## Critères

1. OK : Chaque facture du tableau « Impayés de plus de 30 jours » est impayée dans data/factures/factures.csv et a plus de 30 jours de retard à la date du titre de la sortie (31 jours ou plus).
2. OK : Aucune facture n'est oubliée : toute facture impayée de plus de 30 jours du fichier est dans le tableau, et les autres factures impayées sont nommées dans « Non concernées ».
3. OK : Le montant TTC de chaque facture du tableau est égal à son montant HT plus sa TVA, d'après le fichier. Si le fichier se contredit sur une facture, la sortie le signale au lieu de recopier le montant fautif.
4. OK : Le total TTC annoncé est exactement la somme des montants TTC du tableau.
5. OK : Chaque brouillon de relance donne le numéro, le montant TTC et la date d'échéance de sa facture, identiques à ceux du tableau.

## Corrections

Aucune.

# Definition of done : Factures

Ces critères sont écrits avant le travail de l'agent. Le Juge compare sa sortie à chacun d'eux, un par un, et rend un verdict : accepté seulement si les cinq sont respectés.

1. Chaque facture du tableau « Impayés de plus de 30 jours » est impayée dans data/factures/factures.csv et a plus de 30 jours de retard à la date du titre de la sortie (31 jours ou plus).
2. Aucune facture n'est oubliée : toute facture impayée de plus de 30 jours du fichier est dans le tableau, et les autres factures impayées sont nommées dans « Non concernées ».
3. Le montant TTC de chaque facture du tableau est égal à son montant HT plus sa TVA, d'après le fichier. Si le fichier se contredit sur une facture, la sortie le signale au lieu de recopier le montant fautif.
4. Le total TTC annoncé est exactement la somme des montants TTC du tableau.
5. Chaque brouillon de relance donne le numéro, le montant TTC et la date d'échéance de sa facture, identiques à ceux du tableau.

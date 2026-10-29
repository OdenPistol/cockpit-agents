# Verdict du Juge : Factures

Verdict : REJETÉ
Agent vérifié : factures
Sortie jugée : ../../out/factures/relances-2026-10-29.md
Bilan : Factures rejeté, 1 correction.

## Critères

1. OK : Chaque facture du tableau « Impayés de plus de 30 jours » est impayée dans data/factures/factures.csv et a plus de 30 jours de retard à la date du titre de la sortie (31 jours ou plus).
2. OK : Aucune facture n'est oubliée : toute facture impayée de plus de 30 jours du fichier est dans le tableau, et les autres factures impayées sont nommées dans « Non concernées ».
3. ÉCART : Le montant TTC de chaque facture du tableau est égal à son montant HT plus sa TVA, d'après le fichier. Si le fichier se contredit sur une facture, la sortie le signale au lieu de recopier le montant fautif.
4. OK : Le total TTC annoncé est exactement la somme des montants TTC du tableau.
5. OK : Chaque brouillon de relance donne le numéro, le montant TTC et la date d'échéance de sa facture, identiques à ceux du tableau.

## Corrections

1. Pour F-2026-0079, signaler dans la sortie que le fichier se contredit (HT plus TVA ne donne pas le TTC enregistré) au lieu de recopier 1 650,00 € sans réserve, dans le tableau, le brouillon et le total, et indiquer le montant à confirmer.
   Preuve : le tableau (ligne 14) et le brouillon (ligne 90) donnent « 1 650,00 € » pour F-2026-0079, sans aucune alerte. La source ../../data/factures/factures.csv ligne 20 donne montant_ht 1300,00 et tva 260,00, soit 1300 + 260 = 1560,00, alors que montant_ttc vaut 1650,00 (écart de 90,00 €). Les cinq autres factures du tableau sont cohérentes (3200+640=3840, 1950+390=2340, 1400+280=1680, 1250+250=1500, 2750+550=3300). Le total de 14 310,00 € repose donc sur un montant contradictoire (avec 1560,00 il serait de 14 220,00 €).

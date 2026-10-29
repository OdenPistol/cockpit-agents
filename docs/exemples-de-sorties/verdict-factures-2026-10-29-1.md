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

1. Pour F-2026-0079 (Nourrisson Gestion), signaler dans la sortie que le fichier se contredit (HT + TVA ne donne pas le TTC enregistré) au lieu de recopier 1 650,00 € sans réserve, puis reporter ce signalement dans le tableau, le brouillon et le total.
   Preuve : la sortie écrit « | F-2026-0079 | Nourrisson Gestion | 2026-09-21 | 38 | 1 650,00 € | » et, dans le brouillon, « d'un montant de 1 650,00 € TTC ». La source ../../data/factures/factures.csv ligne 20 donne montant_ht 1300,00, tva 260,00, montant_ttc 1650,00. Calcul refait : 1300,00 + 260,00 = 1560,00, soit 90,00 € de moins que 1650,00. La sortie ne signale pas cette contradiction. Les 5 autres lignes du tableau sont cohérentes (0069 : 3200+640=3840 ; 0072 : 1950+390=2340 ; 0075 : 1400+280=1680 ; 0076 : 1250+250=1500 ; 0077 : 2750+550=3300). Vérifié par ailleurs : retards corrects à la date du 2026-10-29 (90, 75, 54, 40, 39, 38 ; 0080 à 29 et 0083 à 19 jours, donc bien écartées), les 10 factures impayées du fichier sont toutes citées, et le total 14 310,00 € égale la somme des montants du tableau (3840+2340+1680+3300+1500+1650).

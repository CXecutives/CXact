# Bewertungsregel

Diese Regel gilt für die Prüfung in einem KI-Chat aus CXact. Das Profil gewinnt: Jede Schwelle
kommt aus dem Profil, ein Schlüssel, den das Profil nicht setzt, schaltet seine Regel ab.

Die weiteren Anzeigen, die ein Portal unter einer Anzeige zeigt (etwa „Ähnliche Projekte“ oder
„Similar jobs“), gehören nicht zu ihr. Keine Regel liest sie, und sie schließen nichts aus.

## Punkte von 0 bis 100

Die Skala ist dieselbe wie in CXact.

- 90 bis 100 Kernfeld, alle Muss-Punkte erfüllt
- 70 bis 89 Kernfeld, kleine Lücken oder überqualifiziert
- 50 bis 69 ein Muss-Punkt zum Kern der Rolle offen
- 30 bis 49 mehrere Muss-Punkte oder eine formale Pflicht offen
- 0 bis 29 außerhalb des Fachgebiets

Ab {HIGH_FROM} Punkten ist die Übereinstimmung hoch, ab {MID_FROM} mittel, darunter gering. Jede Kompetenz
zählt gleich. Ein fehlender Kann-Punkt kostet höchstens 5 Punkte. Die Entfernung kostet bei Interim und
Projekten nichts.

## Obergrenzen

- Eine formale Pflicht offen (Abschluss, Zulassung, Zertifikat) höchstens 40
- Mindestens zwei und mindestens die Hälfte der Muss-Punkte offen höchstens 40
- Eine Junior- oder Einstiegsrolle bei mindestens 10 Jahren Berufserfahrung höchstens 40
- Ein Muss-Punkt zum Kern der Rolle, also zum Thema des Titels, offen höchstens 60
- Eine Anzeige ohne erkennbare Anforderungen höchstens 60
- Kein fachlicher Muss-Punkt erfüllt höchstens 30
- Nichts offen mindestens 40

## Vertragsart und ANÜ

- Die Vertragsart zählt so, wie das Profil sucht: Interim und Projekte (Tagessatz, freiberuflich,
  Werkvertrag, Contract) zählen voll, eine Festanstellung etwa ein Zehntel weniger (CXact rechnet
  sie mit 90 %), solange das Profil keine ausschließt.
- Zeigen Wunschrollen und Konditionen des Profils klar nur eine Art, kostet eine andere Art etwa 10 Punkte.
- Eine unklare Vertragsart ist ein Punkt zum Prüfen, nie ein Ausschluss, auch wenn das Profil
  Festanstellungen ausschließt.
- Eine Personalagentur ohne Angaben zur Vertragsart ist unklar. Das Gehalt wird wie bei einer
  Festanstellung geprüft, nur als offener Punkt, und das Risiko der Arbeitnehmerüberlassung wird genannt.
- Arbeitnehmerüberlassung (auch ANÜ, Überlassung) schließt aus, wenn das Profil sie ausschließt. Als
  eine von mehreren Möglichkeiten oder nur angedeutet (Payrolling, Equal Pay, iGZ, BAP) ist sie ein
  offener Punkt.

## Ausschluss

- Ein Ausschluss braucht ein wörtliches Zitat aus der Anzeige, das ihn belegt.
- Nur harte Kriterien schließen aus. Das sind Arbeitnehmerüberlassung ohne zeitarbeit in
  vertragsarten, eine genannte Festanstellung ohne festanstellung in vertragsarten, ein Tagessatz
  unter tagessatz_min, ein Land außerhalb von laender (eine voll remote Stelle nie), ein Gehalt unter
  mindestgehalt bei einer genannten Festanstellung, eine zwingende formale Pflicht und ein Wort aus
  ausschlusswoerter.
- Ein Ausschlusswort schließt nur aus, wenn es die Stelle selbst beschreibt, also im Titel, in der
  Karrierestufe der Portalseite oder in einem Satz über die angebotene Rolle und ihre Bedingungen.
  Erwähnt die Anzeige es nur, etwa beim Team, bei Menschen, die die Rolle betreut, in einer
  Verneinung oder einer Anforderung, schließt es nicht aus, im Zweifel auch nicht.

## Wunschrollen und Wünsche

- Eine passende Wunschrolle (wunschrollen) ist ein Plus von höchstens 10 Punkten. Sie hebt keine
  Obergrenze auf.
- Wünsche (tagessatz_wunsch, arbeitsmodell und regionen) schließen nie aus und bewegen die
  Bewertung zusammen höchstens 10 Punkte nach oben oder unten. Nennt die Anzeige einen Wert nicht,
  zählt der Wunsch nicht.
- Wunschrolle und Wünsche heben keinen Job auf {HIGH_FROM} oder mehr, wenn weniger als die Hälfte der
  Muss-Punkte erfüllt ist.

# Bewertungsregel

Diese Regel gilt für die Prüfung in einem KI-Chat aus CXact. Das Profil gewinnt: Jede Schwelle
kommt aus dem Profil, ein Schlüssel, den das Profil nicht setzt, schaltet seine Regel ab.

Die weiteren Anzeigen, die ein Portal unter einer Anzeige zeigt (etwa „Ähnliche Projekte“ oder
„Similar jobs“), gehören nicht zu ihr. Keine Regel liest sie, und sie schließen nichts aus.

## Grundsatz

Bewertet wird wie ein erfahrener Personalberater für Interim-Manager und freie Berater: fair,
logisch und eher wohlwollend, aber glaubwürdig. Was eine Anzeige nicht oder nur vage sagt, kostet
nichts, denn man kann nachfragen. Punkte kostet nur, was klar nicht passt.

## Passungsgrad von 0 bis 100

Die Zahl ist der Anteil dessen, worauf es bei der Stelle ankommt, den das Profil erfüllt, mal dem
Rahmen. Der Inhalt setzt sich aus drei Teilen zusammen, jeder mit seinem festen Gewicht:

- Rolle und Fach ({W_ROLE}): Passen Titel und Fachgebiet zu den Wunschrollen (wunschrollen) und zum
  Profil? Gleiches Fach zählt voll, ein nahes {FIELD_NEAR}, ein fernes {FIELD_FAR}, ein fremdes nichts. Dazu die
  Ebene (siehe unten). Ein Titel, der eine Wunschrolle trifft, ist nie ein fremdes Fach. Eine
  Anzeige ohne Muss-Punkte im Fach des Profils zählt mindestens als nahes Fach.
  Allgemeine Methoden wie Projekt- oder Stakeholder-Management erfüllen Muss-Punkte, zeigen aber
  kein Fachgebiet.
- Kern der Rolle ({W_CORE}): der Anteil der erfüllten Muss-Punkte zum Thema der Rolle, gezählt als
  mindestens {CORE_SATURATION}. Was die Anzeige zum Kern nicht nennt, zählt wie Rolle und Fach und die übrigen
  Muss-Punkte im Mittel.
- Weitere Muss-Punkte ({W_MUSTS}): der Anteil der übrigen erfüllten Muss-Punkte, gezählt als mindestens
  {MUST_SATURATION}. Was eine kurze Liste nicht nennt, zählt zu {UNNAMED} wie Rolle und Fach.

Ein teilweise erfüllter Punkt zählt fast voll (CXact rechnet {PARTIAL}). Was unklar ist, zählt nicht mit.
Erfüllte Kann-Punkte bringen bis zu {NICE_MAX} Punkte dazu, offene kosten nichts.

Dann der Rahmen: Tagessatz, Arbeitsmodell und Ort, Start, Dauer und Auslastung gegen die Wünsche. Was
die Anzeige nicht nennt, passt. Jede genannte Bedingung, die schlechter ist als gewünscht, aber kein
hartes Kriterium verletzt, kostet {FRAME_STEP_COST} der Zahl, eine nur knapp verfehlte die Hälfte.
Eine Festanstellung kostet danach {PERMANENT_COST}, solange das Profil sie nicht ausschließt. Zuletzt
gilt die niedrigste Grenze (siehe unten).

So liest sich die Zahl:

- 90 bis 100 alles Wesentliche passt
- 75 bis 89 passt, eine kleine Lücke
- 50 bis 74 passt in Teilen
- 25 bis 49 passt wenig
- unter 25 passt nicht

Ab {HIGH_FROM} Punkten ist die Übereinstimmung hoch, ab {MID_FROM} mittel, darunter gering.

## Wie ein Berater liest

1. Wunschlisten sind keine Pflicht. Es zählen die wichtigsten Punkte, bei „A oder B“ reicht ein
   Zweig, und Kann-Punkte bringen nur Plus.
2. Was aus der Rolle folgt, gilt als belegt. Wer eine Leitungsrolle sucht oder hatte (Head of,
   Leiter, Interim-Manager), bringt Führung, Budget und Stakeholder-Management mit. Das folgt aus den
   Wunschrollen und der Ebene des Profils, nie aus den Jahren allein.
3. Ähnliches ist teilweise erfüllt, nicht offen: ein anderes Tool derselben Art (CRM, ERP, BI,
   Ticketing, Contact-Center-Software), ein nahes Fach, gleichwertige Normen.
4. Floskeln und Selbstverständlichkeiten zählen nicht: analytisches Denken, Hands-on-Mentalität,
   Reisebereitschaft, MS Office, Teamfähigkeit.
5. Branche und geforderte Berufsjahre kosten wenig und deckeln nie.
6. Eine Ebene Abstand kostet kaum etwas. Erst zwei Ebenen zählen deutlich.
7. Im Zweifel gilt die günstige Lesart: bei Spannen das obere Ende, bei „6 Monate plus Verlängerung“
   die Verlängerung, bei „80 bis 100 %“ beides. Ausgeschlossen wird nur bei klarem Widerspruch.
8. Eine kurze Anzeige wird nicht bestraft. Sie wird aus Titel und Fach beurteilt.

## Muss-Punkte

- Muss-Punkte sind fachliche Anforderungen, Abschlüsse und Zulassungen. Soft Skills und Sprachen sind
  keine Muss-Punkte und bringen keine Punkte. Nur eine verlangte Sprache ab {LANGUAGE_MUST_LEVEL}, die das Profil nicht
  erfüllt, zählt wie ein offener Muss-Punkt.
- Ein Muss-Punkt, den das Profil nur über seine Tools (methoden_tools) belegt, zählt halb, außer der
  Titel nennt das Tool. Kernkompetenzen zählen voll. Jahre und Sterne gewichten nichts.
- Was das Profil wörtlich nennt, ist erfüllt, auch wenn die Anzeige Erfahrung oder Berufserfahrung
  davor schreibt.
- Verlangt die Anzeige einen Abschluss und nennt das Profil keinen (abschluesse), ist er unklar. Das
  deckelt nicht, außer die Anzeige verlangt ihn zwingend und ohne „oder vergleichbar“.

## Ebene

- Die Ebene einer Rolle kommt aus dem Titel: Sachbearbeitung, Agent und Assistenz, dann Fachkraft,
  dann Spezialist, Senior und Referent, dann Teamleitung, Projektleitung und Beratung, dann die Leitung
  eines Bereichs (Head, Leiter, Programmleitung), dann Geschäftsführung und C-Level. Interim ist eine
  Vertragsform, keine Ebene. Disziplinarische Führung in der Anzeige macht eine Rolle zur
  Führungsrolle, ohne Personalverantwortung ist sie keine.
- Nennt eine Wunschrolle die Ebene der Anzeige, passt die Ebene voll.
- Eine Ebene über oder unter dem Profil kostet kaum etwas (Rolle und Fach zählen zu {LEVEL_ONE}).
- Zwei Ebenen über dem Profil halbieren Rolle und Fach.
- Zwei oder mehr Ebenen unter dem Profil heißen höchstens {LEVEL_CAP}, außer eine Wunschrolle nennt diese
  Ebene. Das ist nie ein Ausschluss.

## Grenzen

Jede Grenze braucht einen klaren Grund in der Anzeige.

- Der Kern der Rolle ist klar offen, also weniger als die Hälfte seiner Punkte erreicht und ein
  Muss-Punkt zum Kern offen: höchstens {CORE_OPEN_CAP}
- Das Fachgebiet ist fremd: höchstens {OFF_FIELD_CAP}
- Eine zwingende formale Pflicht ist offen (Abschluss, Zulassung, Zertifikat): höchstens {FORMAL_CAP}
- Eine Junior- oder Einstiegsrolle bei mindestens {SENIOR_YEARS} Jahren Berufserfahrung: höchstens {JUNIOR_CAP}
- Zwei oder mehr Ebenen unter dem Profil: höchstens {LEVEL_CAP}

## Vertragsart und ANÜ

- Die Vertragsart zählt so, wie das Profil sucht: Interim und Projekte (Tagessatz, freiberuflich,
  Werkvertrag, Contract) zählen voll, eine Festanstellung ein Zehntel weniger (CXact rechnet sie mit
  {PERMANENT_FACTOR}), solange das Profil keine ausschließt.
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
- Bei Spannen entscheidet das obere Ende, bei „ab“ der genannte Wert.
- Ein Ausschlusswort schließt nur aus, wenn es die Stelle selbst beschreibt, also im Titel, in der
  Karrierestufe der Portalseite oder in einem Satz über die angebotene Rolle und ihre Bedingungen.
  Erwähnt die Anzeige es nur, etwa beim Team, bei Menschen, die die Rolle betreut, in einer
  Verneinung oder einer Anforderung, schließt es nicht aus, im Zweifel auch nicht.

## Wunschrollen und Wünsche

- Eine passende Wunschrolle gehört zu Rolle und Fach. Sie bringt keinen eigenen Bonus und hebt keine
  Grenze auf.
- Wünsche (tagessatz_wunsch, arbeitsmodell und regionen) schließen nie aus. Sie zählen nur im
  Rahmen und heben die Zahl nie. Nennt die Anzeige einen Wert nicht, passt der Wunsch.

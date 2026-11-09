# PR #7 — Gemeinsame Freigabe für Schutzmigration und Anschlussauslieferung

Vorbereitet am 9. November 2026. **Nur Vorbereitung; nicht zur Ausführung freigegeben.**

## Ergebnis der Zugangs- und Backup-Prüfung

- Hostinger-Plugin: authentifizierter Lesezugriff erfolgreich, Website
  `ardore-health.com` aktiv, Node.js 22. Schreibberechtigungen wurden nicht durch
  Änderungen getestet; erfolgreicher Lesezugriff beweist sie nicht.
- Build `01a1851e-7ecf-73f9-8383-146afcb02891`: `completed`, Commit
  `ceea6d43f5aa2a85e9a5fcfeb2f3a201184e26a1`. Git-Autodeployment eingeschaltet,
  `nchieu45-blip/Ardore`, `main`. Kein Build/Restart ausgelöst.
- hPanel-Zugang am 9. November direkt im angemeldeten Ardore-Dashboard bestätigt.
  Menü „Weitere Aktionen“ zeigt **„Pull-Request-Vorschauen aktivieren“**: automatische
  PR-Previews sind deaktiviert. Nur das Menü geöffnet; die Option nicht angeklickt.
  Dies ist kein separater Erreichbarkeitstest früherer Preview-URLs. Keine neuen
  Previews starten und keine Schlüssel in Chat kopieren.
- Neuester vollständiger Sicherungsnachweis:
  `/Users/nam/Nam/Business/Ardore-Backups/20261109T200121Z/verification.json`.
  Datenbankprüfung abgeschlossen am **9. November 2026, 21:01:56 MEZ**.
- Erfolgreich isoliert wiederhergestellt: **89 Tabellen, 941 Zeilen**, keine
  abweichenden/unerwarteten Tabellen oder Katalogunterschiede. Alle neun
  Storage-Dateien in fünf Buckets lokal wiederhergestellt und auf Größe/Hash geprüft.
- Quell-DB read-only, TLS/Hostname verifiziert, konsistenter DB-Snapshot.
  Restore-Netzwerk `none`, keine veröffentlichten Ports. Temporärer Restore-
  Container nachweislich entfernt. Keine Produktionsschreibzugriffe/App-/Mailtests.
- Verschlüsselte DB-, Rollen-, Restore-Inventar-Archive und Storage-Index erneut
  anhand der protokollierten Prüfsummen verifiziert; separater Schlüssel vorhanden.
- Gegenüber dem Backup vom 28. Oktober kamen ausschließlich die Systemtabellen
  `storage.bucket_lifecycle_states` und `storage.lifecycle_abandoned_artifacts`
  samt Storage-Funktionen/Triggern hinzu. Keine katalogisierten Änderungen an
  Ardore-Public-Tabellen, Views oder Policies gefunden. Vor späterer Storage-
  Reparatur aktuelle Storage-Kompatibilität prüfen; alte lokale Integrationstests
  belegen diese neue Systemversion nicht. Die Ardore-Migrationshistorie hat weiterhin
  50 Einträge; alle fünf PR-Migrationen sind unangewendet.
- Backup-Voraussetzung für den aktuellen Plan erfüllt. Datenbank und Storage
  haben getrennte Sicherungsfenster; dies ist kein Live-Test von Auth/SMTP/Stripe
  und kein Nachweis einer vollständigen Produktions-Disaster-Recovery.

## Umfang der späteren gemeinsamen Freigabe A + B

**A:** Genau die erste Schutzmigration aus dem
[Einzelfreigabepaket](account-deletion-gate-approval.md), Projekt
`yboeyxqeileicecqpwke`, Datei
`20261029005756_account_deletion_release_gate.sql`, SHA-256
`f80c6314903bbed467ca2fba870597b937002307267a6e3415a5165b79f3e2a1`.
Datei unverändert über den Supabase-Plugin anwenden. Direkt anschließend Historie,
geschlossenen Schalter, pausierte Claims, ACLs, Hook und alle 13 Trigger sowie
reale markierte/unmarkierte GET-/HEAD-Proben ohne Kundendatenausgabe prüfen.
Die Freigabe schließt diese nicht-mutierenden Verifikationen ein, keine Löschprobe.

**B, nur nach nachgewiesenem A:** PR #7 über den normalen geschützten PR-Weg
in `main` mergen und das dadurch ausgelöste Hostinger-Autodeployment überwachen.
Referenz des geprüften Anwendungscodes:
`ef44e0487461be37640e9c9b54dc482e40ba7609`.
Die Plandokumente wurden zunächst als Commit
`2e338bab4d9b7055a8db01b248ba9ef7eecd6344` auf den Featurebranch gepusht.
Für Freigabe und Ausführung gilt stets der endgültige PR-Head samt eigener
erfolgreicher Node-22-CI; nachfolgende Dokumentation nicht mit alter CI gleichsetzen. Bei Code-/Basisänderungen Prüfung erneuern; keine Blankofreigabe für
beliebige spätere Änderungen oder Umgehung von Branchschutz/Reviews.

Nach Merge: main-CI erfolgreich, Hostinger-Build erfolgreich und exakt der neue
main-Commit ausgerollt. Nicht-mutierende Seiten-/Servicegesundheit und Readiness
`false` nachweisen. Keine Buchung, Zahlung, echte Mail oder Kontolöschung testen.
Löschung bleibt geschlossen, dauerhafte Mail-Claims bleiben pausiert.

## Auswirkungen, die der Eigentümer ausdrücklich akzeptieren muss

Zwischen A und gesundem B können alte servergestützte Funktionen 503 liefern.
Die Kontolöschung bleibt auch danach gesperrt. Die Claim-Pause verzögert bestimmte
App-Benachrichtigungen bis zur separat genehmigten Wiederaufnahme; Auth-SMTP wird
nicht dadurch pausiert. Ohne geplanten zeitnahen Fortgang von C–E oder separat
geprüfte notification-only-Wiederaufnahme A nicht starten. Kein garantierter
Null-Ausfall und keine angenommene maximale Wartungsdauer.

## Vor Freigabe/Ausführung noch zu erledigen

1. **Erfüllt:** aktueller Backup-/Restore-Nachweis oben. Nicht allein wegen dieses
   Checklistenpunkts erneut sichern. Bei zeitlich späterem Cutover neue Datenstände
   bewerten; das Backup erteilt keine Berechtigung zur Wiederherstellung in Produktion.
2. **Erfüllt:** angemeldeter hPanel-Zugang und deaktivierte automatische
   PR-Previews direkt im Dashboard bestätigt. Vor späterer Ausführung nur bei
   abgelaufener Sitzung oder geänderten Einstellungen erneut prüfen.
3. Endgültigen PR-Head und aktuellen main abgleichen; Node-22-CI, Vorschauen aus
   und GitHub-Migrationsschalter absent/false unmittelbar vor Ausführung prüfen.
4. [Anbieterwechsel und Wiederaufnahme](account-deletion-provider-handover.md)
   sind konkret vorbereitet: zwei finale App-Keys erst nach A/B, getrennten SMTP-Key
   behalten, Runtime-Belege vor Widerruf, erneuter Journalabgleich vor Wiederaufnahme.
   Termin, Zugang und nachfolgende Freigaben noch festlegen. Diese gemeinsame
   Freigabe erlaubt weder neue Schlüssel noch deren Änderung/Widerruf.
5. Nach Abschluss dieser Punkte die ausgefüllte Freigabe vorlegen. Bis dahin
   **kein Ausführungs-GO**. Nicht A allein starten und erst danach B genehmigen lassen.

## Verbleibende Freigabeliste nach aktueller Prüfung

| Voraussetzung | Status / konkret nächster Nachweis |
| --- | --- |
| Aktuelles Backup + Restore | Erfüllt, `20261109T200121Z` |
| Anwendungscode-CI | Erfolgreich am unveränderten Head `ef44e0487461be37640e9c9b54dc482e40ba7609`, Run 40859882652 |
| main / Hostinger | Unverändert `ceea6d43f5aa2a85e9a5fcfeb2f3a201184e26a1`, erfolgreicher Build |
| Schutzmigration | Unverändert, noch nicht angewendet; Gate fehlt, 0 Guard-Trigger, kein konkurrierender Hook |
| GitHub-Migrationsschalter | In Repository und `Production` weiterhin absent; keine automatische Anwendung |
| hPanel / Previews | Erfüllt: angemeldet; Menü bietet „Pull-Request-Vorschauen aktivieren“, automatische Previews aus |
| Endgültiges Freigabeartefakt | Erste vier Plandokumente als `2e338ba` auf PR-Branch; ergänzter Anbieterplan wird auf demselben Branch geprüft. Vor Ausführung aktuellen PR-Head und zugehörige CI auslesen |
| Releaseweg | PR weiterhin Entwurf; vor B erforderliche Reviews/Branchregeln prüfen, nichts umgehen |
| Zeitnaher Fortgang / Benachrichtigungen | Standard C–D–E und Abgleich vorbereitet; alle drei Journale derzeit leer. Termin und Freigaben fehlen; notification-only-Alternative noch nicht als ausführbare Migration geprüft |
| Eigentümerfreigabe | A + B einschließlich Wartungswirkung noch ausdrücklich ausstehend |

Nächster Freigabepunkt: erfolgreiche CI am endgültigen Featurebranch-Head
festhalten, Termin und erforderliche Freigaben für Standardweg C–D–E klären und
dann ausgefüllte gemeinsame Freigabe A + B vorlegen. Backup, hPanel-Zugang und
Preview-Deaktivierung sind bereits nachgewiesen. Kein Wartungsfenster allein
aufgrund grüner CI starten. Keine erneute Vollprüfung ohne relevante Änderungen verlangen.

## Abbruch und Rückfall

- A schlägt fehl oder Zustand unklar: Historie/Katalog prüfen, kein B und kein
  blindes Wiederholen. Verbindungsabbruch beweist keinen Rollback.
- A erfolgreich, B fehlgeschlagen: Gate geschlossen lassen und Schutz behalten.
  Logs lesen und konkrete markierte Reparatur vorbereiten. Die Freigabe deckt
  keinen ungeprüften Forward-Fix ab. Vor dem ersten gesunden B existiert noch
  kein nachgewiesener markierter Deployment-Fallback; mögliche verlängerte
  Wartung ist ausdrücklich Teil des Risikos.
- Nach gesundem B dessen genaue SHA/Build-ID als Rückfallbasis erfassen.
  Keine Rückkehr auf unmarkierten Altcode, keine Rücknahme von Schutztriggern,
  keine Datenbankwiederherstellung über neuere Kundentransaktionen.
- Nicht ohne eigene Freigabe Claims wieder freigeben oder die letzte
  Aktivierungsmigration als vermeintlichen Mail-Fix verwenden.

## Späterer Freigabetext — heute noch nicht abgegeben

„Ich genehmige nach geprüftem aktuellem Backup und bestätigtem Zugang gemeinsam
Stufe A mit der benannten Datei/Prüfsumme und anschließend Stufe B mit dem hier
eingetragenen endgültigen PR-Head: **[vor Freigabe ausfüllen]**. Ich akzeptiere die
beschriebene mögliche Wartungsunterbrechung und vorerst pausierte Benachrichtigungen.
Kontolöschung bleibt geschlossen. Keine weiteren Migrationen, Provideränderungen,
Schlüsselwiderrufe oder Produktionsdatentests. Bei Abweichungen stoppen.“

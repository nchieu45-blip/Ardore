# PR #7: Hostinger-Auslieferung und sicherer Rückfall

Stand: 29. Oktober 2026, nach Abgleich mit main `c3fed1e`.
Dies ist der maßgebliche operative Ablauf; historische SHAs und Abläufe in
älteren Prüfberichten sind keine aktuellen Auslieferungsziele.

## Entscheidung heute

**NO-GO für die Produktionsauslieferung.** Der Eigentümer erlaubt ein Deployment
unter der Bedingung, dass alle Prüfungen und Sicherheitsnachweise passen.
Die unten beschriebenen Hostinger-Nachweise fehlen weiterhin. Die bedingte
Freigabe erfüllt diese Nachweise nicht. Produktionsmigrationen brauchen eine
separate Freigabe für die drei exakten Dateien; sie ist hier nicht enthalten.

Der lokale main-Abgleich ist konfliktfrei und enthält PRs #11 und #12:
Storno-/Erstattungs-E-Mails, Gruppenverschiebungen und deren bereits angewendete
SQL-Historie. Keine angewendete Migration wurde verändert. Die aktuelle Reparatur
ist der Feature-Branch `codex/safe-account-deletion`; vor jeder Freigabe seinen
exakten Head und dessen erfolgreiche Node-22-CI im PR festschreiben.
Eine CI des früheren Heads `9e64b5e` beweist diese Integration nicht.

## Aktuelle Nachweise und Kandidaten

| Bestandteil | Nachweis |
| --- | --- |
| main / Hostinger-Produktion | `c3fed1ebbd799f9aa3723004d071e8224c97cdf6`, Node 22; bei Prüfung abgeschlossener Build `01a1842d-6206-73e3-8112-59effea7b5e8` |
| Unabhängige Sperrbasis | `codex/account-deletion-hostinger-baseline`, `dfeaa128ba0a7b06f0b556d1f8eb5c42afad3971`; enthält aktuelles main, keine PR-#7-Reparaturhistorie |
| Rückfall nach Reparatur | `codex/account-deletion-recovery`, `bb6103fec0afcd1b6e58f3c094d1cb1f9c72f287`; gleiche gesperrte Laufzeit wie Sperrbasis, Reparatur-SQL/-Historie erhalten |
| Sperrbasis-CI | Node 22.23.4; npm ci, Lint, TypeScript, 956 Regressionstests und Build erfolgreich: [Lauf](https://github.com/nchieu45-blip/Ardore/actions/runs/40763903236) |
| Rückfall-CI | Node 22.23.4; dieselben Checks erfolgreich: [Lauf](https://github.com/nchieu45-blip/Ardore/actions/runs/40763913284) |
| Lokale Sperrprüfung je Kandidat | 961 Offline-Tests, Lint, TypeScript, Build, 137 HTTP-Sperrprüfungen einschließlich 50 paralleler Anfragen und drei Redirect-Prüfungen |
| Reparatur mit aktuellem main | 1.069 Offline-Tests und 68 reale lokale Supabase-Prüfungen bestanden; isolierte Reminder-SQL-Suite einschließlich zweier paralleler Verbindungen bestanden; Lint ohne Fehler/vier bestehende Warnungen, TypeScript und Webpack-Build bestanden (75 statische Seiten); neue Node-22-CI am endgültigen PR-Head prüfen |
| Supabase-Backup | `20261028T195659Z`: 87 Tabellen/872 Zeilen und Kataloge isoliert geprüft, neun Storage-Dateien bytegenau wiederhergestellt; Schlüssel separat außerhalb Git |
| Produktionsmigrationen | 50 angewendet; genau die drei unten genannten Reparaturdateien fehlen |
| Automatische Migrationen | `SUPABASE_MIGRATIONS_ENABLED` fehlt in Repository und Environment `production`; nicht aktivieren oder dispatchen |
| PR-Previews | Deaktiviert lassen; vor jedem Push im hPanel frisch prüfen |

`70ddca2`, `878c315`, `44f12d4` und `38f6e03` sind überholte Kandidaten.
Nicht über aktuelle main-Funktionen zurückrollen. Der Rückfallbranch ist
**kein initialer Sperr-Merge**: seine Abstammung enthält bereits PR #7.

Die 68 lokalen Prüfungen verwenden echte lokale GoTrue-/PostgreSQL-/Storage-
Operationen mit fiktiven Fixtures und die tatsächliche Löschorchestrierung.
Sie prüfen beide Richtungen der Buchungs-/Upload-/Bestellrennen, bezahlte und
kostenlose Gruppenverträge, Erinnerungs-Claims, Verschiebungen parallel zu
Löschversuchen, den tatsächlichen E-Mail-Worker mit simuliertem Transport und
Datenbank-Abschlussfehlern, Stripe-Lese-/Kündigungs-/Timeout-Fehler und vier
parallele Wiederholungen mit genau einer Löschung ohne erneute Kündigung.
Stripe und E-Mail sind simuliert; keine echten Zahlungen oder Nachrichten.
Die ursprünglichen drei lokalen Auth-Fixtures bleiben erhalten.

## Offene harte Betriebsgrenze

Hostinger hat für dieses Managed-Webhosting weder eine dauerhafte Sperre vor
allen Produktions-/Origin-Zugängen noch einen belastbaren Nachweis über
beendete alte Löschanfragen und sichere automatische Rückfälle bestätigt.
Ein neuer Build mit 503-Antwort stoppt neue Anfragen an diesen Build; er beweist
nicht, dass alte Ausführungen beendet sind oder nie wieder aktiviert werden.

Die bisher gelesenen Buildlogs enthalten „Stopping processes from the previous
version“. Das ist ein Plattformschritt, kein Nachweis über abgeschlossene
Supabase-/Stripe-Anfragen. Leere Accesslogs, 120 Sekunden Wartezeit, Neustart,
Backup oder zwei erfolgreiche Builds ersetzen diesen Nachweis nicht.
Ein eigener manueller Rückfallbranch kontrolliert keinen automatischen
Plattform-Rückfall. Ohne belastbaren Betriebsweg bleibt der Vollrollout gestoppt.
Ein alternativer Mechanismus muss separat konkret vorbereitet und geprüft
werden; fehlende Belege werden nicht durch eine allgemeine Freigabe ersetzt.

## Ausführungsfolge mit Stopppunkten

### 1. Kandidaten und Freigabefenster festhalten

1. Weitere unabhängige main-Änderungen für das Auslieferungsfenster aussetzen.
   Remote-main, PR-Head, Hostinger-SHA und die hier genannten Kandidaten vergleichen.
   Bei Drift stoppen, betroffene Kandidaten abgleichen und erneut testen.
2. Aktuellen Backup-Zeitpunkt, sichere Aufbewahrung und Wiederherstellungszuständigkeit
   bestätigen. Datenbank und Storage haben getrennte Aufnahmefenster; spätere
   Kundentransaktionen niemals durch einen blinden Restore verwerfen.
3. Beide Migrationsschalter absent/false und keine automatische Migration prüfen.
   Das Environment-Label allein erzwingt derzeit keine Genehmigung.
4. Previews ausgeschaltet halten. Der alte PR-Preview
   `lightseagreen-nightingale-626897.hostingersite.com` war produktionsverbunden.
   Seine Entfernung wurde früher durch 403/404 belegt; spätere Verbindungsfehler
   sind kein neuer HTTP-Status und kein Beleg über ausgelaufene Requests.
   Keine Anmeldung oder Löschprobe mit echten Zugangsdaten durchführen.
5. Alle produktionsverbundenen Zugänge inventarisieren: www, Stammdomain,
   temporäre Hostinger-Domain, Vercel-/direkte Origin-Zugänge und alte Previews.
   Eine andere Domain beweist keine getrennte Datenbank.

### 2. Erst die unabhängige Sperrbasis veröffentlichen

Diese Produktionsänderung ist getrennt vom späteren Reparatur-Merge zu beurteilen.
Nur die geprüfte Sperrbasis `dfeaa12` über einen eigenen main-PR veröffentlichen.
Sie pausiert ausschließlich Kontolöschung; andere aktuelle main-Funktionen bleiben.

1. Erfolgreiche CI und den tatsächlich veröffentlichten SHA/Build prüfen.
2. Auf jedem inventarisierten Zugang cookielos `GET /api/account/delete` prüfen:
   503, `X-Ardore-Account-Deletion: paused-v1`,
   `Cache-Control: private, no-store`. Redirects einzeln prüfen.
   Niemals echte Benutzer-Cookies/Tokens für eine Löschprobe verwenden.
3. Bei Build-/Routingfehler gilt die Sperre nicht als aktiv: stoppen, kein SQL.
4. Wenn separat freigegeben, denselben gehaltenen Stand erneut veröffentlichen,
   um die dokumentierte Zwei-Versionen-Aufbewahrung mit gesperrten Builds zu
   belegen. Das allein garantiert keine automatische Fallback-Policy.
5. **Stopppunkt vor jedem SQL:** alte Produktions-/Preview-Ausführungen nachweisbar
   stilllegen, bereits gestartete oder abgebrochene Löschungen lesend abgleichen
   und festlegen, dass kein automatischer Rückfall den alten Pfad wieder öffnet.
   Hostingers bisherige Auskunft erfüllt diesen Punkt nicht. Ohne Nachweis stoppen.

### 3. Reparatur gegen den tatsächlich gehaltenen main-Stand prüfen

Den aktuellen PR erneut mit der veröffentlichten Sperrbasis integrieren.
Nur in der späteren reparierten Version die harte Proxy-/Route-Sperre bewusst
entfernen; übrige Auth-/Proxy-Regeln erhalten. Lint, TypeScript, vollständige
Regressionen, isolierte Gruppen-/E-Mail-/Stripe-/Paralleltests und Node-22-CI
für den endgültigen SHA prüfen. Der jetzige Abgleich mit `c3fed1e` ersetzt
diese spätere Integrationsprüfung nicht.

Für den hier gewählten Ablauf bleibt die harte Sperrbasis während aller
Migrationen aktiv. Anschließend öffnet der Reparatur-Release die Funktion.
Die neue Implementierung verweigert ohne ihre RPCs zwar sicher die Löschung,
aber das ersetzt weder die Sperrbasis noch den Nachweis stillgelegter Altprozesse.
Es gibt im heutigen PR keinen separaten Schalter zum späteren Wiederöffnen.

### 4. Genau drei separat freigegebene Migrationen unter aktiver Sperre

Erst nach bestandenem Stopppunkt exakt diese Inhalte in dieser Reihenfolge
durch den verbundenen Supabase-Migrations-Plugin anwenden:

| Datei unter supabase/migrations/ | SHA-256 |
| --- | --- |
| `20261018120029_guard_account_storage_deletion.sql` | `99597b69fc51e95270988fd60307bd3b8794e15419d05bcfdf1b60e41c3ebadb` |
| `20261019131618_scope_public_view_projections.sql` | `73e3f95b5d68f6c3e0f89d996de8d6b4e759baeb3f1addef2a75b6e4ed06a5d9` |
| `20261023090520_account_deletion_write_barrier.sql` | `925330bc16702cce8f5915ca023c9f5a2693e73219a6ee69e225083822596551` |

Vor jedem Aufruf Historie und Dateiinhalt prüfen. Keine der 50 angewendeten
Migrationen erneut ausführen, ändern oder entfernen. Kein CLI/GitHub db push,
Reset, Seed oder Datenbank-Rollback. Der Plugin vergibt seine Historienversion:
tatsächliche Version je Datei notieren, nicht automatisch umschreiben.

Nach jeder Datei Historie/Katalog prüfen und beim ersten Fehler stoppen.
Jede Datei hat ihre eigene Transaktion; ein späterer Fehler nimmt frühere
Dateien nicht zurück. Nach Timeout den tatsächlichen Zustand lesen.
Anschließend View-Verträge/Rechte, private RLS, service-only RPCs, Storage-/
Record-Trigger, Schema-Cache und Advisors prüfen. Keine Kundenschreibtests.

### 5. Reparierte Kontolöschung freigeben

Erst wenn alle vorigen Punkte passen, darf die bedingte Deployment-Freigabe
genutzt werden. Sie muss Merge in main, Hostinger-Deployment und die damit
verbundene Wiederöffnung umfassen. Bei geändertem Umfang erneut abstimmen.
Den endgültigen Reparatur-SHA mergen, CI/Hostinger-Erfolg und alle Origins
prüfen. Produktionschecks bleiben nicht mutierend. Keine echte Kontolöschung,
Buchung, Zahlung oder E-Mail als Smoke-Test.

## Rückfall

| Zeitpunkt | Sichere Reaktion |
| --- | --- |
| Sperrbasis nicht erfolgreich veröffentlicht | Alte Produktion kann weiterlaufen; keine behauptete Sperre, keine Migration |
| Basis aktiv, Prüfung/CI/SQL scheitert | Basis gesperrt lassen; erfolgreiche SQL-Dateien erhalten |
| Einzelne SQL-Datei scheitert | Historie lesen; nur fehlende Datei oder geprüfte Vorwärtskorrektur separat freigeben |
| Reparatur läuft fehlerhaft | Aktuellen gesperrten Rückfall über normalen main-PR-/CI-Weg veröffentlichen; nie alten Hostinger-Stand restaurieren |
| Rückfall baut nicht oder Plattformreaktion unklar | Betreiber einschalten; keine alte Löschung, Triggerabschaltung oder Barrierenbereinigung freigeben |

`bb6103f` ist die geprüfte Rückfallquelle auf heutigem main. Nach Änderung der
Releasebasis vorab erneut integrieren und testen; kein späterer Blind-Revert.
Der Rückfall dauert CI/Build-Zeit und ist kein nachgewiesener Sofort-Rollback.
Nach jedem Rückfall 503-/no-store-Marker auf allen Origins bestätigen.
Angewendete SQL-Historie bleibt erhalten. Unklare Auth-/Stripe-Ausgänge behalten
Barrieren und Wiederherstellungsdaten; kein automatischer Refund oder manuelles
Löschen ungeklärter Sperren.

## Quellen und Ausführungsgrenze

[Hostinger: Node.js Deployments](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/),
[Hostinger: PR-Previews](https://www.hostinger.com/support/how-to-use-pull-request-previews-for-node-js-websites-in-hostinger/).

Die Vorbereitung ändert nur den Feature-Branch und lokale Test-Fixtures.
Kein main-Merge, Hostinger-Deployment, Produktions-SQL oder Produktions-Schreibtest
wurde ausgeführt. Eine grüne CI hebt den offenen Betriebs-Stopppunkt nicht auf.

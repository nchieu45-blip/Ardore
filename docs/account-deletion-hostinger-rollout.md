# PR #7: Hostinger-Auslieferung und sicherer Rückfall

Stand: 28. Oktober 2026, Europe/Berlin. Vorschau-/CI-Vorbereitung ausgeführt;
Produktionsauslieferung und Migrationen weiterhin nicht freigegeben.

## Ausführungsnachweis: Preview und Node-22-CI

Der Eigentümer hat die Preview-Abschaltung und CI-Prüfung separat freigegeben.
Hostinger bestätigte die Abschaltung; nach Neuladen bietet das Menü nur noch
"Pull-Request-Vorschau aktivieren" an. Das bestehende Preview lief zunächst weiter.
PR #7 wurde deshalb ohne Merge geschlossen, die Entfernung abgewartet und der PR
danach unverändert als Draft wieder geöffnet. Wiederholte anonyme Prüfungen,
auch nach beiden CI-Läufen: Startseite HTTP 403, bisheriges App-Bundle HTTP 404.
Die Ardore-Anwendung wird dort nicht mehr ausgeliefert. Dies ist kein Nachweis
für den Abschluss früherer Requests/Transaktionen und erfüllt nicht Schritt 3.5.

Beide Kandidaten wurden nur auf ihre Feature-Branches gepusht. Der vorhandene
Workflow `ci.yml` wurde gezielt per `workflow_dispatch` auf diesen Branches
gestartet; dafür wurden keine neuen PRs/Previews angelegt:

| Kandidat | Laufzeit | Ergebnis |
| --- | --- | --- |
| `70ddca2`, Sperrbasis | Node 22.23.4 | `npm ci`, Lint, TypeScript, 923 CI-Tests und Build erfolgreich; [CI](https://github.com/nchieu45-blip/Ardore/actions/runs/40602483511) |
| `878c315`, Rückfall | Node 22.23.3 | `npm ci`, Lint, TypeScript, 923 CI-Tests und Build erfolgreich; [CI](https://github.com/nchieu45-blip/Ardore/actions/runs/40602486503) |

Die fünf zusätzlichen App-URL-Tests sind im lokalen 928-Test-Lauf enthalten,
nicht im bestehenden CI-Glob. Produktion/main blieb `b182637`; Hostinger zeigt
weiterhin denselben abgeschlossenen Produktionsbuild. Der Migrationsschalter
fehlt weiterhin sowohl auf Repository- als auch auf Environment-Ebene. Keine
Produktionsmigration, kein main-Merge oder Produktionsdeployment wurde ausgelöst.

Beim erneuten main-Abgleich am 28.10. zeigt das frisch geladene hPanel weiterhin
"Pull-Request-Vorschau aktivieren" (Previews aus) und Produktion auf `b182637`.
Anonyme CLI-/Browserabrufe des alten Preview-Hosts scheitern derzeit mit
Verbindungs-/HTTP2-Protokollfehlern; ein aktueller HTTP-403/404-Status lässt sich
daher nicht erneut belegen. Das ersetzt weder den früheren Entfernen-Nachweis
noch den weiterhin offenen Nachweis über ausgelaufene alte Anfragen.

## Entscheidung und Grenze

Empfohlen ist eine gestufte Umstellung: kurzzeitig gesperrte Anwendung als
Basis herstellen, Datenbank schützen, dann die reparierte Kontolöschung freigeben.
Kein gleichzeitiger Blind-Merge mit Migrationen und kein SQL vor dem sicheren
Basiszustand. Die Übergangszeit ist eine Wartungsphase für die Kontolöschung.

Die folgenden Schritte verwenden vorhandene Kontrollen. **Ein uneingeschränktes
GO besteht nicht:** Hostinger hat keinen unabhängigen All-Origin-Sperrpunkt und
keinen belastbaren Nachweis für das sichere Ende alter Requests bestätigt.
Der erste Wechsel vom alten Löschpfad zur gesperrten Basis hat deshalb eine
offene Übergangsgrenze. Sie wird durch diesen Plan nicht stillschweigend
akzeptiert. Ohne nachgewiesene Stilllegung alter Ausführungen keine Migration.
Wenn dieser Nachweis auf dem Tarif nicht möglich ist, bleibt der Vollrollout
gestoppt; ein alternativer Betriebsweg oder eine ausdrücklich neu bewertete
Risikofreigabe braucht eine eigene Entscheidung. Kein Timeout/Neustart ersetzt sie.

## Verifizierter Ausgangsstand

| Bestandteil | Ergebnis |
| --- | --- |
| Produktion | `ardore-health.com`, GitHub `nchieu45-blip/Ardore`, `main`, Node 22, veröffentlichter Stand `b182637` |
| Reparatur | PR #7, Draft; main `b182637` am 28.10. konfliktfrei integriert. 1.036 lokale Offline-Tests, 60 echte lokale Supabase-Prüfungen sowie Lint, TypeScript und Webpack-Build erfolgreich. Exakten neuen Reparatur-SHA und zugehörige Node-22-CI im PR prüfen; frühere CI von `eccb417` gilt nicht für die neue Revision |
| Geprüfte Sperrbasis | GitHub-Branch `codex/account-deletion-hostinger-baseline`, `70ddca2`; main `b182637` plus vier geprüfte Sperr-/Testdateien, ohne PR-#7-Abstammung; Node-22-CI erfolgreich |
| Vorbereiteter Rückfall | GitHub-Branch `codex/account-deletion-recovery`, `878c315`; gleiche Anwendungs-/Testdateien wie Sperrbasis, alle SQL-Dateien aus aktuellem main und die drei PR-#7-Dateien erhalten; Node-22-CI erfolgreich |
| Rückfallprüfung | Je 928 lokale Offline-Tests; Lint, TypeScript und Webpack-Build erfolgreich; 137 lokale HTTP-Sperrprüfungen und drei Redirect-Prüfungen ohne Service-Zugangsdaten; zusätzlich je 923 erfolgreiche Node-22-CI-Tests |
| Automatische Migrationen | Schalter in Repository und Environment `production` nicht gesetzt; Job ist dadurch gesperrt. Das Environment selbst hat keine Freigaberegeln |
| Supabase | Projekt `yboeyxqeileicecqpwke`, die drei PR-Migrationen fehlen; Gruppenmigrationen vorhanden; geprüfte View-/Storage-Verträge und DDL-Rechte passen |

CI: https://github.com/nchieu45-blip/Ardore/actions/runs/40545067492

Während der Vorbereitung wurde PR #10 unabhängig von dieser Arbeit in main
übernommen und durch Hostinger veröffentlicht. Seine Gruppenerinnerungen und
die bereits angewendete Migration `20261027225809_group_session_reminders.sql`
bleiben in beiden Kandidaten erhalten. **Die älteren Kandidaten `44f12d4` und
`38f6e03` sind keine freigegebenen Ziele mehr**, da sie diese main-Änderung nicht
enthalten. Die aktuelle ursprüngliche Reparatur-CI prüft noch den älteren Stand.

Die Hostinger-Buildprotokolle zeigen beim Publish einen Versionswechsel und
"Stopping processes from the previous version". Das belegt den protokollierten
Plattformschritt, keinen nachgewiesenen Graceful Drain oder Abschluss aller
bereits gestarteten Supabase-/Stripe-Anfragen. Eine direkte Rollback-Steuerung
wurde weder im Dashboard noch im verfügbaren MCP gefunden.

## Preview-Verbindung: konkrete Prüfung

PR-Preview: `https://lightseagreen-nightingale-626897.hostingersite.com`.
Der Hostinger-Bot bestätigt dort `eccb417`. Ein anonymer GET lieferte HTTP 200.
In zwei öffentlich ausgelieferten JS-Bundles steht der Ardore-Supabase-Endpunkt
als Argument der Browser-Client-Initialisierung, gefolgt von einem öffentlichen
Publishable-Key. **Der Browser-Client zeigt auf Produktion.** Keine Schlüsselwerte
wurden ausgegeben; keine Anmeldung und kein Schreib-/Löschtest wurden ausgeführt.
Serverseitige Service-/Stripe-/Resend-Schlüssel des Previews sind nicht verifiziert.
Ein separater Domainname beweist daher keine Datenisolation.

Die zweite Hosting-Website `indigo-meerkat-455802.hostingersite.com` läuft als
Express-Anwendung und hat laut einzeln gelesener öffentlicher `SUPABASE_URL`
eine andere Zieladresse. Sie ist kein nachgewiesener Ardore-Produktionsalias.
Ihre Schlüssel oder übrige Konfiguration wurden nicht verändert.

Im vorhandenen Dashboard wurde folgender Menüpunkt gelesen:
**Websites → ardore-health.com → Dashboard → ⋮ → Pull-Request-Vorschau deaktivieren**.
Bei Planerstellung nicht angeklickt; inzwischen freigegeben ausgeführt. Der
Schalter allein entfernte das vorhandene Preview nicht, siehe Nachweis oben.
Das Preview ist auch keine eigene Website im verfügbaren Hostinger-MCP.

## Ausführung: Verantwortliche, Nachweis und Stopppunkt

Die oben protokollierte Vorbereitung ist ausgeführt. Alle weiteren nachstehenden
Änderungen brauchen noch eine konkrete Freigabe. Codex kann
Git, Prüfungen und einzeln genehmigte Supabase-Migrationen übernehmen. Der
Eigentümer genehmigt Produktion; Hostinger/Betreiber liefert Plattformnachweise.
Keine Datenbank-/Schlüsseländerung wird aus einer Code-Freigabe abgeleitet.

### 1. Preview zuerst absichern

1. Nach gesonderter Freigabe den oben gefundenen Preview-Menüpunkt deaktivieren.
   Nur PR-Previews ändern, GitHub-Verbindung/main-Autodeployment beibehalten.
2. Prüfen, ob das bestehende Preview tatsächlich unerreichbar wird. Nicht annehmen,
   dass der Schalter laufende Previews entfernt. Keine echten Logins zum Prüfen.
3. Falls es erreichbar bleibt: Nach ausdrücklicher Freigabe PR #7 **schließen,
   nicht mergen**, Hostinger-Entfernung abwarten und anonymer GET prüfen. Dann PR #7
   als Draft wieder öffnen, Preview-Schalter unverändert aus lassen. Branch und
   Commits erhalten. Prüfen, dass kein neues Preview entsteht; sonst stoppen.
4. Alle übrigen offenen PRs prüfen; bei dieser Inventur gab es nur PR #7.
   `www`, Stammdomain, alte temporäre Domain, Vercel-/Origin-Zugänge erfassen.
   Alte Verbindungen dürfen beim nächsten Push keinen unsicheren Stand starten.

Hostinger dokumentiert die Entfernung beim Schließen/Mergen eines PRs:
https://www.hostinger.com/support/how-to-use-pull-request-previews-for-node-js-websites-in-hostinger/
HTTP-Unerreichbarkeit ist ein Zugriffscheck, kein Prozess-/Transaktionsnachweis.

### 2. Release und Rückfall vorab festschreiben

1. Unabhängige Änderungen an main für das Freigabefenster aussetzen. Main-SHA,
   tatsächliche Hosting-Version, CI-Ergebnisse und alle relevanten Origins notieren.
2. Supabase-Backup/Wiederherstellungspunkt, Umfang und zuständige Person bestätigen.
   Hostingers Anzeige "Backups täglich" belegt kein Backup der externen Supabase-DB.
   Keine Wiederherstellung in Produktion als Test ausführen.
3. `SUPABASE_MIGRATIONS_ENABLED` in Repository und Environment absent/false prüfen;
   Workflow nicht starten. GitHub-PR-/CI-Schutz beibehalten. Das Environment-Label
   allein erfordert derzeit keine Genehmigung.
4. Node-22-CI für `70ddca2` und `878c315` ist nach Preview-Abschaltung bestanden.
   Vor einer Freigabe weiterhin exakte SHAs und unveränderte Basis prüfen.
   Keine main-Merges aus dem CI-Erfolg ableiten.
5. Rückfall-SHA und -Quellstand als erlaubtes Ziel dokumentieren. `878c315` ist
   **nur ein Rückfall nach PR #7**, kein Vorlauf-Merge: sein Elternstand enthält
   `eccb417`, und ein früher Merge würde PR #7 bereits historisch integrieren.
6. Bei Änderungen an main nach `b182637` beide Kandidaten neu abgleichen und
   testen. Nicht einen alten Snapshot über neue, unabhängige Funktionen schreiben.

### 3. Gesperrte Basis herstellen — eigene Produktionsfreigabe

1. Nur die Sperrbasis `70ddca2` über einen eigenen geprüften PR in main übernehmen.
   Dafür braucht es Zustimmung zum Merge **und** Hostinger-Autodeployment.
   PR #7 bleibt zunächst ungemergt. Keine Migration zu diesem Zeitpunkt.
2. Deployment-SHA/Status/Protokoll prüfen. Mit einem neuen, cookielosen HTTP-Client
   `GET /api/account/delete` auf jedem inventarisierten Zugang prüfen. Erwartet:
   **503**, `X-Ardore-Account-Deletion: paused-v1`, `Cache-Control: private, no-store`.
   Redirects einzeln prüfen. Keine Benutzer-Cookies oder Authorization mitsenden.
3. Bei Buildfehler bleibt möglicherweise die alte Anwendung aktiv: Sperre gilt
   dann als NICHT ausgeliefert. Stoppen, kein SQL, keine Erfolgsbehauptung.
4. Falls die Basis erfolgreich veröffentlicht ist, denselben unveränderten
   main-Stand mit Hostingers vorhandener Aktion **Erneut bereitstellen** nochmals
   veröffentlichen, nach eigener Freigabe. Beide erfolgreichen Build-IDs müssen
   gesperrten Code enthalten. Das reduziert das Risiko des dokumentierten
   Zwei-Versionen-Puffers; es ersetzt keine Bestätigung der Runtime-Fallback-Policy.
5. **Harter Stopppunkt:** Stilllegung alter Produktions-/Preview-Ausführungen und
   Behandlung eventuell abgebrochener alter Löschungen nachweisen. Leere Logs,
   zwei Builds, ein 503 oder 120 Sekunden Wartezeit reichen allein nicht aus.
   Supabase-/Anwendungsprotokolle nur lesend abgleichen; bei Unklarheit nicht
   migrieren. Hostingers bisherige Aussage liefert diesen Nachweis nicht.

Dokumentiertes Publish-/Aufbewahrungsverhalten:
https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/

### 4. Reparatur gegen die neue Basis integrieren und erneut prüfen

Der Abgleich von PR #7 mit `b182637` ist lokal erfolgt und erneut getestet,
einschließlich paralleler Erinnerungs-Claims und erhaltener Konten/Versanddaten.
Nach der Basis-Auslieferung ändert sich die Integrationsbasis erneut; PR #7 dann
gegen diesen neuen main-Stand abgleichen. Die harte Proxy-/Route-Sperre aus der
Basis darf in der später reparierten Version nicht versehentlich bestehen bleiben.
Bewusst nur den geprüften neuen Löschpfad aktivieren; keine anderen Proxy-/Auth-
Regeln entfernen. Danach alle Checks erneut, inklusive echter lokaler HTTP-
Löschung mit isolierten Fixtures sowie Gruppen-/Stripe-/Paralleltests und Node-22-CI.
Den neuen endgültigen Reparatur-SHA festschreiben. Der aktuelle PR-Stand ist
Ausgangspunkt, kein vorweggenommener zukünftiger Integrations-SHA. Eine grüne CI
nach dem jetzigen main-Abgleich ersetzt diese spätere Integrationsprüfung nicht.

### 5. Nur die drei genehmigten SQL-Dateien anwenden, während die Basis sperrt

Erst nach bestandenem Stopppunkt und eigener Freigabe genau diese Inhalte in
dieser Reihenfolge durch den verbundenen Supabase-Migrations-Plugin anwenden:

| Datei unter `supabase/migrations/` | SHA-256 |
| --- | --- |
| `20261018120029_guard_account_storage_deletion.sql` | `99597b69fc51e95270988fd60307bd3b8794e15419d05bcfdf1b60e41c3ebadb` |
| `20261019131618_scope_public_view_projections.sql` | `73e3f95b5d68f6c3e0f89d996de8d6b4e759baeb3f1addef2a75b6e4ed06a5d9` |
| `20261023090520_account_deletion_write_barrier.sql` | `925330bc16702cce8f5915ca023c9f5a2693e73219a6ee69e225083822596551` |

Vor jedem Aufruf Historie und Dateiinhalt prüfen; kein bereits angewendetes SQL
wiederholen. Der Plugin-Aufruf erlaubt keinen expliziten Versionsparameter:
die tatsächlich erzeugte Historienversion pro Datei protokollieren. Nicht
automatisch Historieneinträge umschreiben, nur um Dateinummern anzugleichen.
Kein CLI `db push`, kein Reset/Seed und kein Aktivieren der GitHub-Automigration.

Nach jeder Datei Historie und Katalog lesen. Beim ersten Fehler stoppen. Ein
Timeout beweist keinen Rollback aller Dateien. Einzelne erfolgreiche Migrationen
bleiben bestehen. Abschließend View-Verträge/-Rechte, private RLS, service-only
RPCs, Storage-/Record-Trigger und PostgREST-Sichtbarkeit bestätigen. Supabase-
Advisors erneut lesen. Keine Kundenlöschung, Buchung, Zahlung oder Test-E-Mail.

### 6. Reparierte Funktion freigeben

Erst nach Schema-Prüfung den endgültigen PR-#7-SHA mit ausdrücklicher Zustimmung
zu **Merge, Deployment und Wiederöffnung der Kontolöschung** in main übernehmen.
Mit vorhandenen RPCs öffnet die neue Anwendung die Funktion beim Deployment;
es gibt im heutigen PR keinen zusätzlichen Reopen-Schalter. Deshalb darf diese
Freigabe nicht erst nach dem Merge erwartet werden. Hostinger-/CI-Ergebnis und
deployed SHA prüfen; andere Origins und Previews dürfen keinen alten Pfad liefern.
Produktionsprüfung bleibt lesend; erfolgreiche Löschung wurde isoliert getestet.

## Konkrete Rückfallmatrix

| Zeitpunkt/Fehler | Aktion |
| --- | --- |
| Vor erster erfolgreicher Sperrbasis | Stoppen. Alte Produktion kann weiterlaufen; keine Migration und keine zugesicherte Sperre. |
| Sperrbasis aktiv, Reparatur/CI/SQL noch nicht erfolgreich | Gesperrte Basis behalten. Bereits erfolgreiche SQL-Dateien nicht zurücknehmen. |
| Einzelne Migration fehlgeschlagen | Historie/Katalog lesen, nur eine noch fehlende Datei oder eine neu geprüfte Vorwärtskorrektur freigeben. Basis bleibt gesperrt. |
| Reparierte Anwendung läuft fehlerhaft | Nach dokumentierter Rückfallfreigabe den vorab geprüften Rückfall-PR auf Basis `878c315` über normalen main-PR-/CI-Weg veröffentlichen. Kein Force-Push/Reset und kein unbelegter hPanel-Rollback-Knopf. |
| Rückfall selbst baut nicht oder unklare Plattformreaktion | Keine alte Version freigeben. Betreiber einschalten; keine Trigger/Barrieren/SQL-Historie entfernen, um die Seite vermeintlich zu reparieren. |

Der Rückfall ist ein neuer Code-Release mit hart gesperrter Löschung und erhaltener
SQL-Historie. Er kann für CI und Build mehrere Minuten benötigen; ein sofortiger
Infrastruktur-Rollback ist hier nicht nachgewiesen. Nach Auslieferung wieder die
503-Marker auf allen Origins prüfen. Nach unsicherem Auth-/Stripe-Ausgang bleiben
Barrieren und Wiederherstellungsdaten erhalten. Kein automatischer Refund und
keine manuelle Kundendaten-Reparatur ohne gesonderte Freigabe.

## Was heute vorbereitet, aber nicht ausgeführt wurde

Preview-Verbindung geprüft, Preview nach Freigabe abgeschaltet und entfernt;
Sperrbasis `70ddca2` und Rückfall `878c315` lokal und in Node-22-CI geprüft. Nur
die beiden Feature-Branches wurden gepusht. PR #7 bleibt offen/Draft/ungemergt.
Kein Produktionsdeployment, Produktions-SQL oder Produktionsdaten-Schreibtest
ausgeführt. Die operative Übergangsgrenze in Schritt 3.5 bleibt offen und ist
keine Code-Testlücke.

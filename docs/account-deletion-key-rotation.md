# PR #7: Schlüsselverbraucher und vorbereiteter Wechsel

Stand: 29. Oktober 2026. Nur lesende Bestandsaufnahme und lokale Dokumentation.
Keine Schlüssel erzeugt, geändert, kopiert/exportiert oder widerrufen; keine
Nachrichten/Zahlungen, Produktionsmigrationen, Merges oder Deployments ausgelöst.
Schlüsselwerte und Identifikationsfragmente gehören nicht in dieses Dokument.
Der [Auslieferungsplan](account-deletion-hostinger-rollout.md) bleibt maßgeblich.

## 1. Ergebnis und Beleggrenze

Hostinger `ardore-health.com` verwendet derzeit einen **eingeschränkten Stripe-
LIVE-Schlüssel**, zugeordnet zu „Ardore Hostinger LIVE“ im Konto Ardore
`acct_1TWlndBWYuyprRwZ`. Typ in vorhandenem Bearbeitungsfeld gelesen und intern
mit dem eindeutigen maskierten Dashboard-Identifier verglichen; kein Wert oder
Fragment ausgegeben. Formular unverändert abgebrochen.

Resend in Hostinger ist anhand des eindeutigen maskierten Identifiers
**„Ardore-Production-2“** zugeordnet. Supabase Auth hat Custom SMTP aktiviert:
`smtp.resend.com`, Port 465, gespeichertes Passwort maskiert. Die Identität dieses
alten SMTP-Schlüssels ist NICHT lesbar; insbesondere ist nicht belegt, dass er
mit dem App-Schlüssel identisch ist. Deshalb beide Verbraucher vor dem Widerruf
auf zwei getrennte neue Schlüssel umstellen. Das leere Passwort-Eingabefeld mit
Masken-Platzhalter bedeutet nicht, dass das gespeicherte Passwort fehlt.

**Noch nicht vollständig geprüft:** Vercel-Anmeldung/Projektbestand. Der geöffnete
Dashboard-Tab zeigt weiterhin die Login-Seite. GitHub und öffentliche HEAD-Proben
belegen nur historische Deployments, keine vollständige Stilllegung aller alten
Instanzen oder den Inhalt ihrer Environment-Snapshots. Solange das offen ist,
keine vollständige Verbraucherfreigabe behaupten und kein Wartungsfenster starten.
Unbekannte Kopien außerhalb der verfügbaren Konten und des lokalen Business-
Arbeitsbereichs lassen sich technisch nicht ausschließen; dafür Provider-
Schlüsselbestand, Zuordnung und letzte Nutzung gemeinsam abgleichen.

## 2. Verbraucherbestand

| Verbraucher | Stripe | Resend | Nachweis / Behandlung |
| --- | --- | --- | --- |
| Hostinger `ardore-health.com`, aktueller Build `ceea6d43` | `STRIPE_SECRET_KEY`, restricted/live, „Ardore Hostinger LIVE“ | `RESEND_API_KEY`, „Ardore-Production-2“ | Bestätigt; nur diese zwei App-Variablen später einzeln ersetzen |
| Hostinger www/Stammdomain, neue Prozesse und Builds | Dieselbe Website-Konfiguration | Dieselbe Website-Konfiguration | Keine eigenen Schlüssel pro Domain; neue Prozesse müssen neue Werte laden |
| Ältere Hostinger-Prozesse/Fallback-Builds | Können alte SDK-Instanzen behalten | Können alte SDK-Instanzen behalten | Nicht als beendet behaupten; alte Keys nach DB-Schutz/Neuversorgung widerrufen |
| Hostinger PR-Preview | Möglicher historischer produktionsverbundener Snapshot | Ebenso | Deaktiviert halten, keine neuen Schlüssel hineinreichen |
| Supabase Auth `yboeyxqeileicecqpwke` | Kein Stripe-Schlüssel für normalen Auth-Betrieb | Resend-Key als SMTP-Passwort | SMTP aktiv, getrennten neuen SMTP-Key vor altem Widerruf setzen |
| Supabase Edge Functions | Keine Functions vorhanden | Keine Functions vorhanden | Über verbundenen Plugin bestätigt; kein Functions-Secretwechsel nötig |
| GitHub Cron | Indirekt über Hostinger: Recovery/Erstattungsabgleich | Indirekt über Hostinger: Reminder/Review-/Lifecycle-Mails | GitHub hat `CRON_SECRET`, keine Stripe-/Resend-Secrets; dort nichts ändern |
| GitHub CI | Nicht funktionsfähiger `ci-placeholder` im Workflow | Kein Resend-Key | Keine Produktionsschlüssel hinzufügen; Tests bleiben Fixtures/Mocks |
| GitHub Environment `Production` | Keine Secrets vorhanden | Keine Secrets vorhanden | Secret-Namen nur lesend geprüft |
| Lokales `/ardore/.env.local` | Test-Key für „Ardore Sandbox“ `acct_1TWlnqBN0jopJxDj` | Kein `RESEND_API_KEY` in gefundener Env-Datei | Konto durch GET `/v1/account` bestätigt; nicht durch Live-Key ersetzen |
| Isoliertes `/ardore-local-test/app/.env.local` | Anderer Test-Key, „Ardore Local“ `acct_1UR91yB2YS03Wz4x` | Kein Resend-Key in gefundener Env-Datei | Eigenes Sandbox-Konto durch GET bestätigt, bleibt unverändert |
| Stripe CLI auf diesem Mac | `whoami`: angemeldet als „Ardore Local“, beide Sandboxes autorisiert | Kein Resend-Verbraucher | Alter TOML-Eintrag zeigt Sandbox; `whoami` ist aktueller Nachweis. Credentials nicht in TOML exportieren |
| Stripe-/Supabase-Plugin-Anmeldung | Separate Connector-Autorisierung | Kein Resend-Plugin verfügbar | Nicht mit App-API-Schlüsseln verwechseln oder abmelden |
| Übrige Ardore-Git-Worktrees | Keine weiteren `.env*` mit Stripe/Resend gefunden | Keine gefunden | Alle gelisteten Worktrees plus Business-Env-Dateien geprüft; generierte Builds und verschlüsselte Backups ausgeschlossen |
| Laufende lokale Node-Prozesse | Keine sichtbaren Schlüssel-Variablennamen im Prozessstart | Ebenso | `ps` zeigt nicht zuverlässig spätere dotenv-Werte: kein Abwesenheitsbeweis; Prozesse nicht beendet |
| Zweite Hostinger-App `indigo-meerkat-455802.hostingersite.com` | Keine Stripe-Env-Namen | Keine Resend-/SMTP-Env-Namen | Separater Node-24-Upload, keine Änderungen; kein Beweis über unbekannte Werte in dessen Quellarchiv |
| Vercel, alte Produktions-/Preview-Deployments | Noch nicht geprüft | Noch nicht geprüft | Dashboard-Anmeldung ausstehend; keine Schlüssel auf Vercel aktualisieren |
| E-Mail-Test-/synthetische Skripte | Teils explizite Test-Schlüssel/opt-in | `scripts/test-email.mjs` liest Resend-Key aus Umgebung; Produktions-Testskript ruft Hostinger-POST auf | Nicht ausgeführt; nicht zum ungefährlichen Konfigurationscheck verwenden |
| Backup-/Restore-Werkzeuge | Kein Stripe-/Resend-Verweis gefunden | Kein Verweis gefunden | Nicht ausführen oder verschlüsselte Backups/Schlüssel öffnen |

Lokale Env-Dateien wurden nur in-memory nach Variablennamen/Modus und Gleichheit
klassifiziert. Keine Werte, Hashes oder Secret-Fragmente ausgegeben/gespeichert.
Die zwei lokalen Stripe-Testkeys sind verschieden. Ein fehlender Env-Eintrag
schließt manuelle Shell-Exports, Keychain-Zugänge oder fremde Rechner nicht aus.

## 3. Betroffene App-Funktionen (ein App-Key pro Provider)

Stripe zentral: `src/lib/stripe/server.ts`.
- Digitale Käufe und Abos: Checkout, Kaufstatus, periodische Abo-Kündigung.
- Coaching-/Gruppen-Checkout, Zahlungsprüfung, Reservierungs-Recovery.
- Stripe-Webhooks: Fulfillment, Bestandsabgleich, Refund-/Settlement-Recovery.
- Connect-Onboarding, Account-/Account-Link-Abfragen und Erstellung.
- Transfers, Transfer-Reversals, Erstattungen und Gebühren-/Saldo-Abgleich.
- PR #7: Accountlöschung prüft Abos und bestätigt deren Beendigung vor GoTrue.

Resend zentral: `src/lib/email/index.ts` (prozesslokal gecachter SDK-Client).
- Kaufbelege, neue Abonnenten, Chat-Benachrichtigungen.
- 1:1-/Gruppenbuchungsbestätigungen und Coach-Benachrichtigungen.
- Verschiebungs-/Storno-/Erstattungsmails, Erinnerungen, Bewertungsaufforderungen.
- PR #7: abonnementsbezogene Abschlussnachrichten nach bestätigter Löschung.
- Separat: Supabase Auth bestätigt Anmeldung/E-Mail und sendet Passwort-Reset,
  Magic-Link-/Einladungsmails über Resend-SMTP. Die App-Migrationssperre pausiert
  diesen Auth-SMTP-Versand NICHT.

Vier Mail-Claim-RPCs führen in **drei** dauerhafte Journale:
`coaching_email_deliveries`, `group_reminder_deliveries`,
`session_notification_deliveries`. Alle drei waren bei dieser lesenden Prüfung
leer. Zum echten Wechsel frisch prüfen; dies beweist keine Abwesenheit bereits
angenommener direkter/alter Provideranfragen. Direkte Kauf-/Chat-/Bestätigungs-
Mails haben nicht alle ein solches Journal und können während des kurzen
Prozess-/Schlüsselhandovers fehlschlagen. Keine Zustellgarantie vortäuschen.

## 4. Bestehender Anbieter-Schlüsselbestand

Stripe Ardore LIVE:
- „Ardore Hostinger LIVE“: eingeschränkt, erstellt 27.10., im Dashboard keine
  letzte Nutzung ausgewiesen. Aktueller Hostinger-Verbraucher bestätigt.
- Standard-Geheimschlüssel: erstellt 14.05., keine letzte Nutzung ausgewiesen.
  Nicht als unbenutzt/frei zum Löschen behandeln; möglichen Altverbrauch prüfen.
- Veröffentlichbarer Schlüssel bleibt erhalten. Webhook-Signing-Secret bleibt
  erhalten. Kein Wechsel zwischen Live und Sandbox, keine API-/SDK-Version ändern.

Beim vorhandenen eingeschränkten Key wurden folgende konkrete Rechte gelesen
(„Schreiben“ schließt lesenden Zugriff ein; Gruppenüberschriften nicht als Rechte
zählen):
- Plattform Schreiben: Charges and Refunds, Customers, Payment Intents, Products,
  Coupons, Prices, Promotion Codes, Subscriptions, Checkout Sessions,
  Account Links, Transfers; außerdem Merchant/Recipient Configuration.
- Plattform Lesen: Balance, Balance Transaction Sources, Payment Disputes,
  Invoices, Accounts v2, Accounts und Application Fees.
- Connect Schreiben: Merchant Configuration und Recipient Configuration;
  Connect Lesen: Accounts v2. Nicht angebotene Connect-Zellen sind keine Freigabe.
Bei Rotation/Neuanlage den exakten vollständigen bisherigen Rechteumfang
vergleichen, nicht anhand dieser verkürzten Liste erweitern oder vermindern.

Resend-Team „ardore.health“ (ein Domain-Eintrag `ardore-health.com`):

| Bestehender Keyname | Rechte | Letzte Nutzung laut Dashboard |
| --- | --- | --- |
| Ardore-Production-2 | Sending access | etwa 14 Stunden vor Prüfung; aktuelle Hostinger-Zuordnung |
| Ardore-Production | Sending access | No activity |
| Ardore_Hostinger | Full access | No activity |
| Onboarding | Sending access | 25 Tage vor Prüfung |

„No activity“ ist kein Beweis über fehlende gespeicherte Kopien. Der alte SMTP-
Key kann nicht sicher einem Namen zugeordnet werden. Nach Neuversorgung beider
bestätigten Verbraucher und Prüfung von Vercel/weiteren Nutzern alle als alt-
produktionsfähig bestätigten Keys explizit benennen und deren Widerruf freigeben.
Keinen allein nach Name/Alter ungeprüft löschen. Full-access-Key nicht als neuen
App-/SMTP-Key weiterverwenden.

## 5. Genau vorbereitete Zielbelegung — noch NICHT angelegt

| Neuer geplanter Keyname | Konto / Rechte | Einziger neuer Einsatzort |
| --- | --- | --- |
| Ardore Hostinger LIVE v2 | Gleiches Stripe-Live-Konto, gleicher eingeschränkter Rechteumfang | Hostinger `STRIPE_SECRET_KEY` |
| Ardore Hostinger Mail v2 | Gleiches Resend-Team, Sending access, Domain `ardore-health.com` | Hostinger `RESEND_API_KEY` |
| Ardore Supabase Auth SMTP v2 | Gleiches Resend-Team, Sending access, gleiche Absenderdomain | Supabase Auth SMTP Password |

Keinen dieser neuen Keys nach Vercel, in lokale Test-Env-Dateien, GitHub, Chat,
Logs oder Git übernehmen. Werte nur vom Provider in die vorgesehenen Secret-
Felder/den freigegebenen sicheren Transport. Neue Zugangsdaten im Browser muss
bei der späteren Änderung der Eigentümer selbst eingeben/bestätigen; Codex
übernimmt Vorbereitung und anschließende nicht-mutierende Prüfung. Keine DNS-,
Webhook-, Supabase-API-Key-, SMTP-Host-/Port-/Absenderänderung erforderlich.

Hostinger-MCP `replace-environment-variables` ersetzt den GESAMTEN Bestand,
löscht ausgelassene Variablen und startet die Anwendung neu. Reads liefern nur
Masken; die lokalen Dateien enthalten NICHT alle 12 Produktionswerte.
**Daher diesen API-Replace nicht verwenden.** Im hPanel ist pro Zeile
„Umgebungsvariable aktualisieren“ vorhanden; später ausschließlich die zwei
benannten Einträge einzeln ändern, alle anderen zehn erhalten. Vor und nach dem
Wechsel dieselbe Liste von zwölf Namen prüfen. Umgebungsänderung kann einen
Neustart bewirken; frisch aufgebauten markierten Build/Runtime-SHA und Health
prüfen. Öffentliche Next-Variablen bleiben unverändert.

## 6. Ausführbare Reihenfolge nach separater Freigabe

0. Vercel-Projekt/Deployment-/Environment-Bestand lesend abschließen und
   zusätzliche Schlüsselverbraucher bestätigen. Hier ausdrücklich nicht anmelden
   mit neuen App-Keys, keine Previews aktivieren. Offene Fälle schriftlich klären.
1. Vor Wartungsfenster: aktuelles Backup, exakter grüner PR-Head, drei benannte
   Zielkeys samt identischen Rechten und deren sichere Übergabe vorbereiten.
   Anlegen, Speichern und Widerruf sind NICHT durch diesen Audit freigegeben.
2. Nach Migrationsfreigabe zuerst die geschlossene Schutzmigration aus dem
   Runbook installieren und tatsächliche Hook-/Auth-/DELETE-Guards nachweisen.
   Neue markierte Anwendung geschlossen ausliefern und Build/SHA/Health prüfen.
3. Stripe-Neuschlüssel sicher nur in Hostinger setzen; aktuelle markierte
   Anwendung neu laden/aufbauen, Konfiguration und Provider-Metadaten prüfen.
   Keine Checkout-Erstellung, Zahlung, Kündigung, Erstattung oder Auszahlung.
   API-Version und Rechte bleiben gleich. Alte Keys bleiben noch aktiv, bis der
   neue Verbraucher nachgewiesen funktioniert; Löschung bleibt geschlossen.
4. Resend-App-Key nur in Hostinger setzen und aktuellen Prozess neu laden.
   SMTP-Passwort in Supabase auf den eigenen neuen Auth-Key setzen; Host, Port465,
   User und Absender unverändert. Beide Verbraucher müssen neu versorgt sein,
   BEVOR irgendein bisher möglicherweise gemeinsam verwendeter Resend-Key entfällt.
   Auth-E-Mails bleiben während App-Claim-Pause grundsätzlich aktiv.
5. Benannte alte Stripe-/Resend-Keys nach ausdrücklicher Freigabe beim Provider
   widerrufen und deren inaktive Metadaten prüfen. Alte Vercel-/Hostinger-Builds
   bekommen keine neuen Keys; bloße Änderung aktueller Env-Werte entfernt keine
   Schlüssel aus alten Deployment-Snapshots oder SDK-Instanzen.
6. Provider-/Auth-Metadaten und alle drei Mailjournale erneut lesend abgleichen.
   Bereits angenommene Aufträge nicht als rückgängig behandeln. Unsichere Mail-
   Zustände nicht blind über einen neuen Key wiederholen. Getrennt genehmigte
   Zustellproben sind nötig, um echten Versand/SMTP abschließend zu beweisen;
   bloße Key-Präsenz oder ein Sending-Key-GET403 beweisen keinen Defekt/Erfolg.
7. Erst dann die drei unveränderten Reparaturmigrationen separat freigeben und
   anwenden; nach Prüfung die letzte Aktivierungsmigration separat genehmigen.
   Keine automatische Freigabe oder chronologischer `db push`.

Rückfall: Gate geschlossen, DB-Guards/Migrationshistorie erhalten, zuletzt
beobachteten markierten Build mit NEUEN Keys nutzen. Nach Widerruf alte Keys nicht
reaktivieren oder alte Env-Snapshots importieren. SMTP-Probleme mit dem neuen,
separaten Auth-Key lösen, nicht die App-/Auth-Trennung rückgängig machen. Vor
Widerruf kann die bestehende Konfiguration weiterlaufen, während geschlossen
korrigiert wird; keine reale Löschung zum Test. Nicht selbstständig Kundendaten
oder unklare Mailjournale „bereinigen“.

## 7. Tatsächlich geprüft; weiterhin unverändert

- Produktion Hostinger: abgeschlossener Build, main `ceea6d43`; zwölf Env-Namen.
- GET der vorhandenen geschützten `/api/admin/email-test`-Diagnostik: 200,
  Resend vorhanden, beide Stripe-Testpräfix-Flags false, kanonische URL true.
  Der Keytyp wurde zusätzlich im hPanel als restricted/live bestätigt; das
  Diagnoseflag allein erkennt eingeschränkte Testkeys nicht zuverlässig.
- Nur GET `/v1/account` mit den beiden vorhandenen lokalen TEST-Keys:
  Sandbox-Zuordnung bestätigt; keine Live-Stripe-API-Aktion ausgeführt.
- Stripe CLI `whoami --format json` angemeldet, beide Sandboxes autorisiert.
- Supabase: keine Edge Functions, drei Mailjournale aktuell leer; nur SELECT.
- GitHub: Repository-Secret nur `CRON_SECRET`, Environment `Production` leer;
  keine Stripe-/Resend-Produktionsschlüssel in CI nötig.
- Zweite Hostinger-App: keine einschlägigen Env-Namen; keine geparkten Ardore-
  Aliasdomains gefunden. Vorhandene Haupt-/www-Verbindung nicht verändert.
- `ardore-health.vercel.app`: HEAD404. Letzter von GitHub bestätigter Vercel-
  Deploymenthost vom 10.10. (`ardore-3jj99qe21-ardore-s-projects.vercel.app`):
  HEAD410. Beides beweist nicht, dass alle alten Deployments weg sind.
- Temporäre Hostinger-URL: kein verifizierbarer HTTP-Status; keine Aussage über
  ausgelaufene Prozesse. Keine Requests an Lösch-/Buchungs-/Payment-Routen.
- Keine Laufzeitdatei oder SQL-Migration geändert. Dokumentationsprüfung statt
  neuer Live-Tests. Bestehende PR-#7-Codeprüfungen bleiben historisch am Head
  `beb6f5749ad26b880e30623af7dbfa487793b807` dokumentiert.

Offizielle Grundlagen:
[Stripe-Schlüsselrotation](https://docs.stripe.com/keys),
[Resend getrennte API-Schlüssel](https://resend.com/docs/dashboard/api-keys/introduction),
[Resend SMTP](https://resend.com/docs/send-with-smtp),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Resend-Idempotenz](https://resend.com/docs/dashboard/emails/idempotency-keys).

# PR #7: konkreter Auslieferungs- und Rückfallplan

Stand: 29. Oktober 2026. Produktionsbasis: main
`ceea6d43f5aa2a85e9a5fcfeb2f3a201184e26a1` (PR #13, nur Release-Regeln).
Dieser Ablauf ersetzt die bisherigen nicht erfüllbaren Hostinger-Drain-Gates.
Frühere Sperr-/Rückfall-SHAs sind historische Nachweise, keine aktuellen Ziele.

## Entscheidung und Mechanismus

**Noch kein Produktions-GO.** Lokal wird die unten beschriebene Reihenfolge
mit echten PostgreSQL-/PostgREST-/GoTrue-/Storage-Diensten und fiktiven Daten
geprüft. Die tatsächliche Stilllegung alter Stripe-/Resend-Schlüssel und die
Produktionsmigrationen sind ausdrücklich noch nicht freigegeben/ausgeführt.
Erfolgreiche CI allein autorisiert sie nicht.

Die Datenbank erhält zuerst einen geschlossenen Freigabeschalter. Ein
Data-API-Hook sperrt alte serverseitige Lesezugriffe auf die vier Tabellen,
aus denen historische Löschrouten ihre Stripe-/Kundendaten beziehen. Neue
Serverclients tragen einen Versionsmarker; dieser ist KEIN Geheimnis oder
Ersatz für Service-Role-Authentifizierung. Zusätzliche DELETE-Statement-Trigger
verhindern sämtliche manuellen REST-Teillöschungen des alten Handlers. Ein
Auth-Validierungstrigger lässt die abschließende GoTrue-Löschung ausschließlich
mit offenem Schalter und gültiger kontobezogener Löschbarriere zu. Er schützt
auch Accounts ohne Profil. Kein direktes Schreiben in `auth.users`.

Ein alter Prozess könnte Providerdaten schon vor der Sperre geladen haben.
Deshalb gehören die nachweisliche Stilllegung ALLER alten produktionsfähigen
Stripe-/Resend-Serverschlüssel und die Prüfung vorher angenommener Aufträge zum
Cutover. Ein alter Build mit NEUEN Schlüsseln bleibt durch die Datenbanklesesperre
blockiert. Kein behaupteter Hostinger-Drain und keine geschätzte Wartezeit nötig.
Bereits vom Provider angenommene Wirkungen werden dadurch NICHT rückgängig.
Unklare Vorgänge bleiben ein Stopppunkt; keine automatische Erstattung oder
wiederholte Nachricht zur vermeintlichen Reparatur.

## Vor dem Wartungsfenster alles vorbereiten

1. Exakten PR-Head, komplette erfolgreiche Node-22-CI und dieses Runbook festhalten.
   main und Hostinger müssen noch dem oben genannten SHA entsprechen; bei Drift
   zunächst abgleichen und betroffene Prüfungen erneut durchführen.
2. Previews im hPanel ausgeschaltet lassen. Kein produktionsverbundenes Preview
   starten. `SUPABASE_MIGRATIONS_ENABLED` in Repository UND Environment absent/false
   halten; Workflow weder einschalten noch manuell ausführen.
3. Backup `20261028T195659Z` (87 Tabellen/872 Zeilen, neun Storage-Dateien,
   isolierter Restore geprüft) ist der bisherige Nachweis. Vor dem Cutover
   Aktualität bestätigen/bei Bedarf frisches Backup nach gesonderter Freigabe;
   Schlüssel separat außerhalb Git. Kein Restore über spätere Kundentransaktionen.
4. Sämtliche Verbraucher und Kopien der produktiven Stripe-/Resend-Schlüssel
   inventarisieren: Hostinger, alte Vercel-Builds/Previews, lokale Prozesse,
   andere Anwendungen und insbesondere Supabase-Auth-SMTP bei gemeinsamem Resend-
   Schlüssel. Nur Namen/Metadaten protokollieren, nie Werte. Geteilte Verbraucher
   müssen mit umgestellt werden. Gleiche Konten, Modi, Rechte/Scopes beibehalten.
   Keine Änderung an Stripe-Webhooksignatur, Public Key, DNS, Supabase-JWT-Keys.
5. Neue Provider-Schlüssel und ihren sicheren Transport in Hostinger konkret
   vorbereiten; Erzeugung/Änderung/Widerruf braucht eigene ausdrückliche Freigabe.
   Alte Schlüssel nicht kopieren/anzeigen und nicht voreilig widerrufen.
6. Freigabe für ein kurzes Wartungsfenster und die exakt benannten Schritte unten
   einholen. Nach erster Schutzmigration können ALTE servergestützte Funktionen
   vorübergehend 503 liefern; Browser-RLS-Zugriffe bleiben bestehen. Dauerhafte
   E-Mail-Claims werden pausiert, vorhandene Claims dürfen ihren Abschluss melden.
   Kein Null-Ausfall-Versprechen. Sämtliche Zugänge/Schlüssel und Zuständigkeiten
   VORHER klären, damit Produktion nicht auf eine spätere Freigabe warten muss.

## Exakte SQL-Dateien und Reihenfolge

**Nicht chronologisch per `db push` anwenden.** Die neue Schutzmigration muss
bewusst VOR den drei älteren Reparaturdateien installiert werden. Die letzte
Datei öffnet Löschung UND Benachrichtigungs-Claims und braucht eine getrennte
Freigabe nach dem Abgleich. Über den verbundenen Supabase-Plugin jeweils den
exakten Dateiinhalt mit passendem Migrationsnamen anwenden und danach die
Migrationshistorie lesen; keine SQL-Abschrift, kein pauschaler CLI-Push.

| Reihenfolge | Datei | SHA-256 |
| --- | --- | --- |
| 1 | `20261029005756_account_deletion_release_gate.sql` | `f80c6314903bbed467ca2fba870597b937002307267a6e3415a5165b79f3e2a1` |
| 2 | `20261018120029_guard_account_storage_deletion.sql` | `99597b69fc51e95270988fd60307bd3b8794e15419d05bcfdf1b60e41c3ebadb` |
| 3 | `20261019131618_scope_public_view_projections.sql` | `73e3f95b5d68f6c3e0f89d996de8d6b4e759baeb3f1addef2a75b6e4ed06a5d9` |
| 4 | `20261023090520_account_deletion_write_barrier.sql` | `925330bc16702cce8f5915ca023c9f5a2693e73219a6ee69e225083822596551` |
| 5 | `20261029014533_enable_account_deletion_protocol.sql` | `302ad4bec2ebcb6b63fb35601ef093dea6cf67f67c916b903613d20fdc1b199c` |

Die drei bisherigen Reparaturdateien und alle 50 bereits angewendeten Dateien
sind unverändert. Die erste und letzte Datei sind neue, separat zu genehmigende
Migrationen. Keine Rückwärtsmigration und kein Replay alter Versionen.

## Ausführen, mit Halt nach jeder Stufe

### A. Schutz zuerst, weiterhin geschlossen

Nach gesonderter Freigabe nur Datei 1 anwenden. Sie setzt `enabled=false` und
`notification_dispatch_paused=true`. `lock_timeout=5s` und
`statement_timeout=30s` begrenzen DDL; Fehler rollen die gesamte Migration zurück.
Ein vorhandener fremder Data-API-Hook führt zum Abbruch statt Überschreiben.
Bei Lock-/Berechtigungsfehler stoppen, keine automatische Endlosschleife.

Nur lesend prüfen (keine echte Kontolöschung als Probe):

```sql
SELECT enabled, notification_dispatch_paused
FROM private.account_deletion_release WHERE singleton;
-- false, true
SELECT count(*) FROM pg_trigger
WHERE tgname IN ('require_account_deletion_protocol','reject_legacy_account_row_deletes')
  AND tgenabled='O'; -- 13; zusätzlich Tabellen/Funktionszuordnung wie Aktivierungs-SQL
SELECT item FROM pg_db_role_setting s,
LATERAL unnest(s.setconfig) item
WHERE s.setrole='authenticator'::regrole
  AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
  AND item LIKE 'pgrst.db_pre_request=%';
```

Mit sicherem Serviceclient GET/HEAD `profiles?select=id&limit=0` ohne Marker muss
503 liefern, mit `X-Ardore-Service-Protocol: v2` 200. Service-only
`account_deletion_release_ready` liefert false. Keine Zeilen/Schlüssel ausgeben.
Der tatsächliche Hook muss aktiv sein: Katalogeintrag allein genügt nicht.
Den PostgREST-Hook nie als Auth-/Storage-Schutz ausgeben; dafür sind Trigger da.

### B. Markierte Anwendung geschlossen ausliefern

Erst wenn A nachgewiesen ist: PR #7 nach exakter grüner CI über normalen PR-Weg
mergen. Dies löst Hostinger aus; main-CI, Build-SHA und nicht mutierende
Seiten-/Auth-/Servicegesundheit prüfen. Die neue Route stoppt beim false-Gate
VOR Barriere, Stripe oder Löschung. Deshalb fehlen zu diesem Zeitpunkt noch
keine zum normalen Betrieb nötigen Lösch-RPCs. Keine echte Löschung/Bezahlung testen.
Die erfolgreich beobachtete neue, markierte Version ist der technische Rückfall-
Ausgangspunkt. Alte Sperrbasis-/Recovery-Branches haben keinen v2-Service-Marker
und dürfen nicht als störungsfreier Rückfall behauptet werden.

### C. Provider-Handover und Abgleich, weiterhin geschlossen

Nach eigener Freigabe die vorbereiteten neuen Stripe-/Resend-Schlüssel sicher
in allen freigegebenen Verbrauchern einsetzen, aktuellen Build neu starten/
bereitstellen und dessen Gesundheit prüfen. Danach ALLE alten produktionsfähigen
Schlüssel beim jeweiligen Provider widerrufen; Widerruf und Kontenzuordnung nur
an Metadaten bestätigen, keine absichtlichen Live-Kündigungs-/E-Mail-Tests.
Ein alter Prozess mit altem SDK-Key verliert zukünftigen Providerzugriff;
ein altes neu gestartetes Programm mit frischem Key scheitert vor neuen Reads.

Stripe-Request-/Event-Metadaten, Resend-Sendestatus, Auth-Audit und die vier
Benachrichtigungsjournale lesend abgleichen. Für Mail insbesondere `processing`,
`pending` und `held` mit `first_attempt_at IS NOT NULL` untersuchen. Completion/
Failure-RPCs bleiben während Claim-Pause zulässig. Bereits angenommene Sends
können erst später sichtbar werden; unklarer Status ist KEIN Zustellfehlerbeweis.
Nicht voraussetzen, dass Resend-Idempotenz zwischen verschiedenen API-Schlüsseln
erhalten bleibt (Dokumentation definiert diese Grenze nicht). Keine Rücksetzung,
Neuschlüsselung oder blinde Wiederholung unsicherer Claims. Nötige Ledger- oder
Kundendatenkorrekturen separat benennen und freigeben lassen. Erst bei geklärtem
Abgleich und bestätigtem Schlüsselwiderruf weitergehen; bei Unklarheit geschlossen.

### D. Drei Reparaturdateien geschlossen anwenden

Nach gesonderter Freigabe Dateien 2–4 einzeln unverändert über Plugin anwenden,
nach jeder Datei Historie/Katalog/Permissions lesen. Alle Trigger, Storage-
Schranken und drei `security_invoker=true`-Views prüfen. Gate bleibt false,
Claims bleiben pausiert. Fehler -> stoppen; bereits angewendete Migrationen und
Barrieren behalten. Keine weiteren Dateien erraten/automatisch nachschieben.
Neue Supabase-Sicherheitsbefunde prüfen; heutiger Produktions-Advisor meldet die
bekannten drei Definer-Views, die Datei 3 korrigiert, außerdem bestehende RPC-
Warnungen/Passwortschutz-Hinweis. Das ist kein schon heute sauberer Produktionsbefund.

### E. Bewusst freigeben

Nur nach A–D, finaler CI/Deployment-/Providerprüfung und neuer ausdrücklicher
Freigabe Datei 5 anwenden. Sie prüft RPC-ACLs, Hooks, 13 Löschschutztrigger,
12 Schreibschutztrigger, Storage-Schutz, Views und Schalterrechte, bevor genau
eine private Steuerzeile auf true/Claims-frei gesetzt wird. Sie kann externe
Providerfreigaben nicht selbst beweisen; diese vorher dokumentieren.

Danach readiness=true, Claims-Pause=false, alte unmarkierte limit=0-Abfrage
weiterhin503, neue markierte200 prüfen. Keine Testkonten in Produktion anlegen/
löschen und keine echten Payments/Mails auslösen ohne eigene Freigabe. Normale
Fehlerraten/Provider- und Auditmetadaten beobachten. Die Anwendung ist nun frei,
die alten Pfade bleiben gesperrt, auch nach Neustart/automatischem altem Fallback.

## Sicherer Rückfall

- Vor A: keine Produktionsänderung; alles bleibt auf dem Featurebranch.
- A fehlgeschlagen: gesamte A-Transaktion zurückgerollt; nicht B/C/D/E fortsetzen.
- Ab A: Datenbank-Hook und Trigger bleiben IMMER erhalten. Nie ursprüngliche
  Providerkeys reaktivieren, SQL zurückrollen, Trigger/RLS abschalten oder main
  force-resetten. Ein Hostinger-Rückfall auf alte Software kann Funktionen 503
  liefern lassen, aber die geschützten Kontodaten nicht manuell löschen.
- B/C/D fehlgeschlagen: Löschung geschlossen halten; auf die beobachtete markierte
  Version zurück/als Forward-Fix veröffentlichen. Schlüsselproblem vor Öffnung
  beheben. Alte unvermerkte Sperrbranches nicht blind ausliefern.
- Nach E: vor Code-Rückfall eine separat freigegebene Forward-Pause ausführen:
  `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
  UPDATE private.account_deletion_release SET enabled=false WHERE singleton;
  COMMIT;` Danach false nachweisen. Keine Auth-Löschung/Barriere bereinigen.
  Diese Pause macht bereits akzeptierte Stripe-/Mail-Aufträge nicht rückgängig.
- Mail-Pause nicht unbegrenzt lassen: falls Auslieferung abbricht, braucht eine
  notification-only-Wiederaufnahme eine eigene geprüfte/freigegebene Forward-
  Migration NACH Provider-/Claim-Abgleich; `enabled` bleibt dabei false.
  Datei 5 niemals als Abkürzung zum reinen Mail-Resume verwenden.

## Lokale Ausführung und belastbare Grenzen

```bash
node scripts/test-isolated-account-deletion-release.mjs --run-isolated
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
node --test scripts/test-app-url.mjs scripts/verify-*.mjs
npm run build
```

Der opt-in-Runner verwendet nur Docker-Kontext `colima-ardore-test`, eigene
zufällige Datenbank/Loopback-Dienste und fiktive GoTrue-Accounts. Er klont nur
Schema plus technische Service-Migrationsversionen, keine Kundendaten. Er entfernt
in dieser leeren Kopie die drei bisher lokal vorhandenen Reparaturen und spielt
die exakte neue Reihenfolge nach. Die drei Review-Views fehlen vor ihrem Aufbau;
das ist kein vollständiger Produktionsklon. Er testet DDL-Locktimeout/Atomizität,
fremden Hook, verfrühte Freigabe, beide Provider-Fehler, schon angenommene Arbeit,
alle vier historischen Löschrouten (auch mit frischen simulierten Schlüsseln),
Rückfall, fehlendes Profil/Barriere, pausierte/abgelaufene Freigabe, normale
RLS-Zugriffe sowie alle 68 Gruppen-/Upload-/Bestell-/Stripe-/Mail-/Paralleltests.
Providerannahme/Widerruf sind simuliert; realer Produktionswiderruf bleibt offen.
Das Original mit drei lokalen Auth-Fixtures bleibt unberührt. Testdienste und
exakt eigene Datenbank werden entfernt; keine Produktionsmigration ausgeführt.

Build-/Typechecks in einer Kopie ohne `.env*`, mit expliziten CI-Platzhaltern.
Lokaler Node 24.15.0 ersetzt nicht Node-22-CI am endgültigen Commit. Vollständige
Prüfzähler/Head/CI-Link im PR festhalten; keine früheren Ergebnisse übernehmen.

Abschließende lokale Probe dieses Standes: **33 Auslieferungsprüfungen und alle
68 Supabase-Integrationsprüfungen bestanden**, 1.073 Offline-Tests bestanden.
TypeScript und Webpack-Build erfolgreich (75 statische Seiten); ESLint null Fehler,
vier bestehende React-Hook-Form-Warnungen. Eigene Testdienste/Datenbank und
temporäre lokale Zugangsdaten entfernt. Node-22-CI nach Feature-Push prüfen.

Offizielle Grundlagen: [Data-API-Hook](https://supabase.com/docs/guides/api/securing-your-api),
[unterstützte Auth-/Storage-Validierungstrigger](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025),
[Stripe-Key-Widerruf](https://docs.stripe.com/keys),
[Resend-Key-Entfernung](https://resend.com/docs/api-reference/api-keys/delete-api-key),
[Resend-Idempotenzgrenzen](https://resend.com/docs/dashboard/emails/idempotency-keys).

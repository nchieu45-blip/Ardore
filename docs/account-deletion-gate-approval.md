# PR #7 — Freigabepaket für die erste Datenbankschutz-Migration

Vorbereitet am 9. November 2026. **NICHT ausgeführt, keine Freigabe erteilt.**
Maßgeblich ist der [gesamte Auslieferungsplan](account-deletion-hostinger-rollout.md).
Die bevorzugte [gemeinsame Freigabe A + B](account-deletion-joint-release-approval.md)
verbindet diese erste Migration mit der Anschlussauslieferung; dieses Dokument
bleibt die genaue technische Spezifikation von A.

## Genau eine beantragte Operation

- Projekt: Ardore, `yboeyxqeileicecqpwke`.
- Datei: `supabase/migrations/20261029005756_account_deletion_release_gate.sql`.
- Supabase-Migrationsname: `account_deletion_release_gate`.
- SHA-256: `f80c6314903bbed467ca2fba870597b937002307267a6e3415a5165b79f3e2a1`.
- Ausführung später ausschließlich über den verbundenen Supabase-Plugin mit
  exakt diesem Dateiinhalt. Nicht abschreiben, umsortieren oder `db push` starten.
  Historieneintrag danach auf Name/Inhalt prüfen; die Plugin-Version kann vom
  lokalen Zeitstempel abweichen. Jede der fünf Dateien genau einmal anwenden.
- Keine der vier anderen ausstehenden Dateien, kein Gate-Öffnen, kein Merge,
  Deployment, Schlüsselwiderruf oder Kundentest ist darin enthalten.

## Wirkung und konkrete Nebenwirkungen

Die Datei legt Steuerobjekte an, setzt `enabled=false` und
`notification_dispatch_paused=true`, installiert zwölf DELETE-Statement-Trigger,
einen Auth-Löschschutz und einen Data-API-Hook. Sie schreibt ausschließlich eine
technische Steuerzeile; keine Kundenzeilen/Storage-Dateien werden gelöscht oder
geändert. Kein direktes INSERT/UPDATE/DELETE auf `auth.users`.

**Wartungswirkung:** Alte servicegestützte GET/HEAD-Zugriffe auf `profiles`,
`creator_profiles`, `subscriptions`, `bookings` liefern 503; der alte
Lösch-Preflight für Gruppenreservierungen ebenfalls. Vier Mail-Claim-RPCs pausieren.
Service-REST-DELETE auf zwölf Tabellen und Auth-Kontolöschungen werden blockiert.
Dies kann auch legitime Service-Löschoperationen betreffen. Browser-RLS-Lesen
bleibt prinzipiell unverändert; ein vollständiger störungsfreier Websitebetrieb
ist damit nicht zugesagt. Auth-SMTP wird durch die Claim-Pause nicht pausiert.

`lock_timeout=5s` begrenzt Lock-Wartezeiten, `statement_timeout=30s` einzelne
Statements, nicht die gesamte Wartung. DDL kann Schreibzugriffe kurz blockieren.
Die Datei ist transaktional; Fehler müssen zum Abbruch und Rollback führen.
Bereits vorher wirksame Provideraktionen oder Transaktionen macht sie nicht rückgängig.

## Vor Ausführung zwingend abhaken

1. Erfüllt: Backup `20261109T200121Z`, 9. November 21:01:56 MEZ,
   89 Tabellen/941 Zeilen und neun Storage-Dateien isoliert wiederhergestellt,
   ohne Abweichungen. Vor späterer Ausführung Aktualität erneut bewerten.
2. Aktuelle main-/Hostinger-SHA, endgültigen PR-Head und erfolgreiche Node-22-CI
   bestätigen. Die derzeitige grüne CI gilt für `ef44e0487461be37640e9c9b54dc482e40ba7609`;
   erster Dokumentations-Push: `2e338ba`. Vor Ausführung den aktuellen
   Featurebranch-Head und seine eigene erfolgreiche CI bestätigen.
3. Bestätigt am 9. November: automatische Previews aus (hPanel-Menü bietet
   „Pull-Request-Vorschauen aktivieren“); GitHub-Migrationsschalter im Repository
   und Environment absent/false. Keine automatische Migration/Preview starten.
4. Hostinger-Plugin-Lesezugriff ist am 9. November bestätigt: aktives Git-
   Autodeployment von `nchieu45-blip/Ardore`, `main`, Build `ceea6d43` erfolgreich.
   Angemeldeter hPanel-Zugriff ist inzwischen direkt im Ardore-Dashboard bestätigt.
   Keine Schreibprobe, kein Neustart und keine Deployment-Aktion ausgeführt.
5. **Vor A auch die ausdrückliche Freigabe und Einsatzfähigkeit für B sichern:**
   markierten Code geschlossen ausliefern und bei Fehler als Forward-Fix retten.
   Diese Datei genehmigt B nicht. Ohne diese Voraussetzung A NICHT starten, da
   sonst alte Servicefunktionen ohne gesicherten Wiederanlauf gesperrt blieben.
6. Provider-Handover einschließlich vor A exponierter v2-App-Keys und legitimer
   Mitverbraucher konkret vorbereiten. Keine Schlüsselwerte protokollieren.
   Wartung nicht beginnen, wenn für nachfolgende notwendige Maßnahmen niemand
   autorisiert/erreichbar ist. Datenbank-Aktivierung bleibt separat freigabepflichtig.
7. Direkt davor SHA-256 erneut berechnen und Migrationshistorie lesen: Datei noch
   nicht angewendet, kein Drift seit Prüfung. Keine alten Migrationen wiederholen.

## Nur lesender Preflight, unmittelbar vor A erneut ausführen

Am 9. November geprüft: `postgres`, Gate fehlt, 0 Schutztrigger,
0 nichtleere vorhandene Hooks, 13 Zieltabellen. Die genauen Definitionen und
Rollenrechte zusätzlich mit dem freigegebenen Stand vergleichen; Tabellenanzahl
allein prüft keine Schema-Kompatibilität und keine laufenden Requests.

```sql
SELECT current_user,
  to_regclass('private.account_deletion_release') AS existing_gate;
SELECT count(*) AS existing_guards FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN
  ('require_account_deletion_protocol','reject_legacy_account_row_deletes');
SELECT count(*) AS conflicting_hooks
FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) item
WHERE s.setrole='authenticator'::regrole
  AND s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
  AND item LIKE 'pgrst.db_pre_request=%' AND item <> 'pgrst.db_pre_request=';
```

Unerwartete Objekte/Hooks, fehlende Rechte, Schema-Drift oder nicht geklärte
Schreibtransaktionen: stoppen und prüfen; nichts überschreiben/erzwingen.

## Verifikation nach separat genehmigter Ausführung

1. Plugin-Ergebnis und genau einen neuen Historieneintrag prüfen. Timeout oder
   Verbindungsabbruch: Zustand/Historie lesend klären, nicht blind erneut anwenden.
2. Technische Steuerzeile lesen: exakt `enabled=false`, Claims-Pause `true`.
3. Alle 13 aktivierten Trigger samt Zieltabellen und Funktionszuordnung prüfen;
   Hook `public.account_deletion_request_gate`, Funktionsdefinitionen/ACLs und
   RLS/fehlende Browserrechte der Steuertabelle bestätigen.
4. Mit bestehendem sicheren Serviceclient, ohne Ausgabe von Credentials/Zeilen:
   GET und HEAD `profiles?select=id&limit=0` unmarkiert jeweils 503, mit
   `X-Ardore-Service-Protocol: v2` jeweils 200. Dieser Test muss gegen die reale
   Data API laufen; ein Katalogeintrag beweist keinen geladenen Hook.
5. Service-only Readiness-RPC liefert `false`; Browser darf keinen Steuerzugriff
   erhalten. Keine DELETE-Probe, Buchung, Zahlung oder E-Mail in Produktion.
6. Zeit und Resultate ohne Kundendaten festhalten. Bei Abweichung keine nächste
   Migration/Aktivierung; markierte Anwendung nur gemäß separater Freigabe retten.

## Rückfall und nächster Freigabepunkt

- Vor Commit/bei gescheiterter Transaktion: tatsächlichen Zustand prüfen;
  keine weiteren Stufen. Nicht behaupten, eine unterbrochene Verbindung beweise Rollback.
- Nach erfolgreichem A: Schutzobjekte/Historie behalten, Gate geschlossen lassen.
  **Kein Rückbau der Migration, kein alter unmarkierter Build als sicherer Rückfall.**
- Vor dem ersten gesunden markierten Build gibt es noch keinen verifizierten
  markierten Deployment-Fallback: deshalb B vor A vorbereiten und genehmigen.
- Nach gesundem B dessen exakten Build als Rückfallbasis festhalten; neue finale
  Providerkeys beibehalten. Keine stillgelegten Credentials wiederherstellen.
- Noch nicht freigegeben: Reparaturdateien 2–4 und abschließende Aktivierung 5.
  Für Provideränderungen/Widerruf jeweils genaue Schlüssel benennen und eigene
  Freigabe einholen. Bereits angenommene Aufträge vorher lesend abgleichen.

Möglicher späterer Freigabetext, erst nach erfüllten Voraussetzungen:
„Ich genehmige Stufe A mit exakt der oben genannten Datei und Prüfsumme im Projekt
Ardore, einschließlich der beschriebenen Wartungswirkung. Keine weiteren
Migrationen, kein Öffnen der Löschung und kein Schlüsselwiderruf.“

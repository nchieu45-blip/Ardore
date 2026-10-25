# Einzelne Gruppenbuchungen und private Videozugänge

## Verhalten

- Im Coach-Profil wird ein konkreter Termin ausgewählt. Auch bei wöchentlichen Kursen gilt jede Buchung und Zahlung nur für diesen Termin. Zeiten werden in Europe/Berlin berechnet; mehrdeutige oder nicht existierende Zeiten bei der Zeitumstellung werden nicht angeboten.
- Dauer, Titel, Preis, Coach, Zahlungsmodus und Abo-Berechtigung werden bei der Reservierung festgehalten. Ein späterer Tarifwechsel verändert keine bereits vereinbarte Buchung. Eine gültige aktive Mitgliedschaft kann die einzelne Session einschließen.
- Platzreservierungen und bestätigte Anmeldungen werden pro Termin unter derselben Datenbanksperre gezählt. Ein unbekanntes Stripe-Ergebnis gibt den Platz nicht allein aufgrund der verstrichenen Zeit frei. Wiederholte Anfragen setzen einen noch offenen Zahlungsversuch fort. Nach Ablauf, Fehlschlag, Stornierung oder abgeschlossener Erstattung kann eine neue Buchung gestartet werden.
- Eine Rückkehr von Stripe bestätigt keine Teilnahme. Erst die geprüfte serverseitige Zahlungsabstimmung bestätigt die Buchung. Nicht mehr erfüllbare Zahlungen gehen in den bestehenden Erstattungsprozess; sie erzeugen keinen zusätzlichen Platz.
- Käufer sehen offene Zahlungen, bestätigte Termine und Erstattungen unter `/buyer/video-classes`. Vor Beginn kann die einzelne Anmeldung vollständig storniert werden. Coaches können eine nicht erbrachte Teilnahme bis zum Terminende absagen. Fehlgeschlagene oder nicht eindeutig zuzuordnende Erstattungen benötigen Support; es wird kein beliebiger Ersatz-Refund erstellt.
- Coaches legen Kurse unter `/creator/settings/video-classes` an und öffnen einzelne Termine über „Session verwalten“. Gebuchte Zeiten und Dauer lassen sich nicht über die Kursvorlage verschieben. Zum Start sind höchstens neun Teilnehmer plus ein Coach je Gruppenraum zugelassen. Die Kursmaske, Buchungsprüfung und eine Datenbank-Constraint halten diese Grenze ein; Daily erhält zehn Plätze inklusive Coach.

## Video und Zugriff

`DAILY_API_KEY` wird ausschließlich serverseitig verwendet. Eine zusätzliche `DAILY_DOMAIN` ist nicht erforderlich: Die vom festen Daily-API-Endpunkt gelieferte Raumadresse wird geprüft. Keine Schlüssel, privaten Raumadressen oder Zugangstokens werden in der öffentlichen Buchungsantwort, im Browser-Speicher oder in Bestätigungs-E-Mails abgelegt.

Neue Gruppenbuchungen bleiben ohne konfigurierten Daily-Schlüssel gesperrt. `videoReady` zeigt die vorhandene Konfiguration an, keine laufende Zustandsprüfung des Providers. Vor einer Freigabe muss der tatsächliche Schlüssel geprüft werden.

Ein eingeloggter Teilnehmer erhält Videozugang ausschließlich für seine bestätigte, nicht erstattete Anmeldung und den konkreten Termin. Kostenpflichtige Teilnahme benötigt eine bestätigte LIVE-Zahlung; TEST-Zahlungen schalten keine reale kostenpflichtige Teilnahme frei. Nur der tatsächliche Coach erhält Owner-Rechte. Vorhandene manuelle Meeting-Links für 1:1 bleiben nutzbar.

Räume werden erst beim ausdrücklichen Beitritt erstellt. Der Zugang öffnet 15 Minuten vor Beginn und endet am Terminende. Neue Räume sind privat, erlauben kein Anklopfen und verwenden eigene Namen je 1:1-Buchung, Verschiebung bzw. Gruppentermin. Der Server prüft die Berechtigung erneut nach Provider-Anfragen, bevor er ein Token zurückgibt. Bereits ausgegebene Daily-Tokens gelten bis zu ihrem Ablauf am Terminende; eine spätere Stornierung sperrt neue Token, beendet jedoch nicht automatisch einen bereits laufenden Daily-Anruf. Externe manuelle Meetings unterliegen weiterhin den Zugangseinstellungen ihres Anbieters.

## Datenbank und Rückwärtskompatibilität

Migrationen: `supabase/migrations/20261018181232_group_session_payments.sql` und `supabase/migrations/20261025130000_group_video_capacity.sql`. Die zweite Migration setzt den Standard auf neun Teilnehmer und verhindert größere oder unbestimmte Gruppenkapazitäten auch bei direkten bzw. konkurrierenden Coach-Schreibzugriffen. Sie ändert keine vorhandenen Kurs- oder Buchungsdaten und bricht bei unpassenden Bestandsangeboten ab.

Sie ergänzt kanonische Termine, private Reservierungen, eine käufereigene eingeschränkte Statusansicht sowie den Zahlungstyp `group`. Bestehende Zahlungsarten werden an ihre bisherigen Implementierungen weitergereicht. Finanzielle Mutationen sind nur über Service-Rollen möglich; Browser dürfen nur ihre freigegebenen Statusspalten lesen. Ein Coach kann keine fremden Kurse ändern.

Historische Kursanmeldungen werden nicht automatisch in neue Einzeltermine oder bezahlte Teilnahmen umgewandelt. Sie bleiben in der Käuferübersicht sichtbar. Finanzielle Referenzen, Abo-Snapshots und festgelegte Coach-Termine verhindern eine unbedachte Kontolöschung; die Prüfung erfolgt vor Kündigungen, Nachrichten und Löschungen.

## Betrieb und Freigabe

1. Daily-Konto und Subdomain einrichten. Den Schlüssel lokal als `DAILY_API_KEY` in der ignorierten `.env.local` hinterlegen und die lokale Anwendung neu starten. Den echten Schlüssel weder in Git noch im Chat veröffentlichen.
2. Eine echte Daily-Verbindungsprüfung und einen freigegebenen Anruf mit Coach und Teilnehmer durchführen. Die lokale Konfigurationsprüfung ersetzt diesen Test nicht. Stripe-Modus und verbundene Auszahlungskonten separat prüfen; dieser PR schaltet keine TEST-Konfiguration auf LIVE um.
3. Die konkrete Produktionsmigration und das Setzen des Produktionsschlüssels separat freigeben lassen. Die Migration muss vor dem neuen Anwendungscode verfügbar sein. Bei einer Anwendung ohne neue Spalten schlagen Gruppen- und Kontolöschfunktionen bewusst fehl, statt veraltete Daten zu interpretieren.
4. Vor dem Merge die GitHub-Variable `SUPABASE_MIGRATIONS_ENABLED` und tatsächliche Freigabegates prüfen: Der Migrationsworkflow kann nach erfolgreicher main-CI automatisch migrieren. Hostinger veröffentlicht den verbundenen main-Branch automatisch. Merge und daraus folgende Veröffentlichung benötigen die konkrete Freigabe des Eigentümers.
5. Signierte Stripe-Webhooks und den bestehenden geschützten `/api/cron/coaching-payments`-Aufruf weiter betreiben. Der Cron prüft nun auch Gruppen-Zahlungen und Erstattungen in begrenzten Batches. Ohne laufenden Recovery-Aufruf bleiben unklare Vorgänge bis zu einem Webhook oder manuellen Fortsetzen möglicherweise offen.
6. Bei Problemen keine Zahlungsdatensätze, Reservierungen oder gebuchten Termine löschen und die Migration nicht destruktiv zurückrollen. Neue Buchungen sperren, den gespeicherten Status prüfen und den Zahlungs-/Erstattungsprozess weiter abstimmen.

## Prüfung

Am 23. Oktober 2026 wurde der lokal hinterlegte Daily-Schlüssel ausschließlich lesend mit `GET /v1/rooms?limit=1` geprüft: HTTP 200 und gültige Listenstruktur. Es wurden dabei keine Räume oder Tokens erstellt und keine Raumdaten oder Schlüssel protokolliert. Ein echter Anruf und eine echte kostenpflichtige Gruppenbuchung wurden dadurch nicht geprüft.

Am 25. Oktober 2026 wurden nach ausdrücklicher Freigabe private Daily-API-Tests ausgeführt. Die unveränderte 1:1-Integration bestand Raum- und Token-Erstellung, getrennte Coach-/Teilnehmerrechte sowie die Prüfung von Privatsphäre, Ablaufzeit und Raumlimit. Der Gruppentest mit der aktuell implementierten Raumgröße von 200 Personen scheiterte: Daily lehnte `max_participants` für den vorhandenen Tarif ab. Ein gesonderter Kapazitätstest mit einer temporären Kopie des Helpers und zehn Plätzen bestand. Diese Kopie ist kein ausgelieferter Anwendungscode. Alle ausschließlich für diese Tests neu angelegten Räume wurden wieder gelöscht. Es wurden keine Medien übertragen, echten Buchungen, Zahlungen oder E-Mails erzeugt. Ein Kamera-/Mikrofon-Anruf ist weiterhin nicht geprüft. Der Eigentümer hat anschließend neun Teilnehmer plus Coach zum Start gewählt. Nach der entsprechenden Anpassung bestand derselbe Gruppentest mit dem tatsächlichen Anwendungscode; auch dieser Testraum wurde gelöscht.

Die separat freigegebene Migration `20261018181232_group_session_payments.sql` wurde am 25. Oktober 2026 auf dem Ardore-Projekt angewendet. Die gespeicherte SQL-Prüfsumme stimmt mit der Repository-Datei überein; die automatisch erzeugte Versionsnummer des Migrationstools wurde in der Historie auf die Repository-Version `20261018181232` abgeglichen. Die neuen Tabellen verwenden RLS, die Statusansicht `security_invoker`, und die Gruppen-/Zahlungs-RPCs sind nur für `service_role` ausführbar. Browserrollen dürfen weder Checkout-URLs noch die internen Reservierungsfelder lesen. Es gab keine bestehenden Gruppenangebote oder Gruppenbuchungen zu migrieren. Diese Prüfung umfasst Schema und Rechte, keine synthetischen Produktionsbuchungen. Auch die Kapazitätsmigration `20261025130000_group_video_capacity.sql` wurde am selben Tag nach isolierter Prüfung auf dem weiterhin leeren Angebotsbestand angewendet; SQL-Prüfsumme und Historienversion wurden abgeglichen. Der freigegebene Daily-Schlüssel ist bei Hostinger einzeln über hPanel ergänzt und die vollständige Schlüsselliste einschließlich E-Mail-/Cron-Konfiguration anschließend lesend verifiziert. Merge und finales Deployment folgen nach grüner CI.

Standardprüfungen aus `AGENTS.md`:

```sh
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
node --test scripts/test-app-url.mjs scripts/verify-*.mjs
npm run build
```

Die Node-Prüfungen verwenden lokale Fixtures und Provider-Mocks. Die SQL-Prüfung ist ausdrücklich opt-in:

```sh
node scripts/test-isolated-group-payments.mjs --run-isolated
```

Sie verwendet ausschließlich den Docker-Kontext `colima-ardore-test` und den Container `supabase_db_ardore-local-test`, legt eine neue Wegwerf-Datenbank an und entfernt nur ihre eigene Datenbank. Bei einem vorhandenen gleichnamigen Datenbankstand bricht sie ab. Es werden keine Zeilen in `auth.users` angelegt oder geändert. Die Fixtures prüfen die neue Migration mit einem minimalen Altschema; die bisherigen Fulfillment-Funktionen sind Delegations-Stubs. Dies ist kein vollständiger Produktions-Dump-Test. Geprüft werden unter anderem Rollen, gesperrte Browser-Mutationen, fremde Identitäten, Abo-Fälle, unveränderliche Vereinbarungen, verspätete Zahlungen und konkurrierende Reservierungen über zwei Verbindungen.

Für die visuelle Prüfung mit echten Komponenten und ausschließlich synthetischen Daten:

```sh
node scripts/preview-group-bookings.mjs
```

Die schreibgeschützte Vorschau unter `http://127.0.0.1:3014/book` zeigt Buchung, Käuferübersicht und Videozustände. Sie benötigt eine zuvor gebaute CSS-Datei. Sie ist statisch und ersetzt keine angemeldete End-to-End-Prüfung. Formular-, Wiederholungs-, Doppel-Klick- und Fehlerpfade werden separat in lokalen Komponentenprüfungen ausgeführt.

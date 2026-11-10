# PR #7 — Anbieterwechsel und Wiederaufnahme der Benachrichtigungen

Vorbereitung vom 9. November 2026. **Keine Ausführungsfreigabe.** Nur Dokumentation;
keine Schlüssel angelegt/geändert/widerrufen, kein Versand und keine SQL-Änderung.
Der [Auslieferungsplan](account-deletion-hostinger-rollout.md) und die
[gemeinsame Freigabe A + B](account-deletion-joint-release-approval.md) bleiben maßgeblich.

## Konkrete Entscheidung für den Wechsel

Der geplante Standardweg ist A → B → C → D → E in einem beaufsichtigten
Wartungsfenster, mit gesonderten Freigaben für Provideränderungen, Reparatur-SQL
und Aktivierung. A nicht starten, solange Zuständigkeit, Zugriff und weitere
Freigaben keinen zeitnahen Abschluss erlauben. Aktueller Betreiber: Codex für
Prüfung/Protokollierung, Eigentümer für Credential-Eingabe/2FA und Freigaben.
Ein Termin und eine garantierte Dauer sind noch nicht vereinbart.

Die bereits vor A konfigurierten App-v2-Keys gelten vorsorglich als für Altcode
erreichbar. Für den Standardweg daher **erst nach nachgewiesenem A und gesundem B**
zwei finale App-Keys vorsehen. Das ist keine Aussage über ein Schlüsselleck.
Eine nachgewiesene vollständige Stilllegung aller Altprozesse wäre eine Alternative,
ist auf Hostinger aber nicht belegt. Keine weitere Rotation jetzt durchführen.

| Verbraucher | Vorgesehener finaler Zugang | Vorgesehener Austausch |
| --- | --- | --- |
| Hostinger `STRIPE_SECRET_KEY` | `Ardore Hostinger LIVE cutover`, restricted, bestehendes Ardore-LIVE-Konto, exakt bisheriger geprüfter Rechteumfang | Nach A + B neu erzeugen und ausschließlich hier einsetzen; vorherige App-Keys danach separat stilllegen |
| Hostinger `RESEND_API_KEY` | `Ardore Hostinger Mail cutover`, Sending access, nur `ardore-health.com` | Nach A + B neu erzeugen und ausschließlich hier einsetzen; vorherige App-Keys danach separat stilllegen |
| Supabase Auth SMTP | Vorhandener `Ardore Supabase Auth SMTP v2` | Beibehalten, sofern nur Auth-SMTP versorgt und nie Alt-App-Code zugänglich; früherer Zustellnachweis vorhanden |

Gleiche Konten/Modi beibehalten. Stripe API `2026-04-22.dahlia`, SDK,
Webhook-Signing-Secret, Public Key, Supabase-API/JWT-Keys, DNS und Absender unverändert.
App-Keys nie in Vercel/Previews, GitHub CI, lokale Test-Env-Dateien oder Chat kopieren.
Werte nur im bestehenden sicheren Transport außerhalb Git bzw. im Passwortmanager
und den ausdrücklich genehmigten Secret-Feldern ablegen.

## C — Schrittfolge nach eigener späterer Freigabe

1. A real wirksam, Gate `false`, Claims pausiert; B mit exakter SHA gesund. Aktuelle
   Provider-/Verbraucherliste mit Namen, IDs, Konto und Rechten aufnehmen, keine Werte.
   Alle legitimen Mitverbraucher versorgen; nicht nach Name/Alter allein widerrufen.
2. Zwei finale Keys gemäß Tabelle neu erstellen und Rechte/Domain vergleichen.
   Eigentümer übernimmt Eingabe/Bestätigung im Dashboard. Keine automatische
   Kontenerstellung, kein API-/SDK-Upgrade und keine zusätzlichen Rechte.
3. Hostinger-Variablen **einzeln** ändern; übrige zehn Einträge erhalten.
   Niemals `replace-environment-variables` mit maskierten/unvollständigen Werten.
   Nur die markierte Version B mit aktuellen Variablen kontrolliert neu laden;
   kein Rollback auf einen alten unmarkierten Build. Neustart separat genehmigen.
4. Gespeicherten Wert und echte Verwendung getrennt prüfen. Ein Match im Editor,
   Key-Präsenz-Flag, direkter Laptop-API-Aufruf oder erfolgreicher Neustart allein
   beweist nicht, welchen Key die Hostinger-SDK-Instanz verwendet.
5. Stripe-Runtime-Nachweis: Quellcode-geprüftes **GET** `/api/stripe/connect` ist bei
   einem vom Eigentümer freigegebenen bestehenden Coach mit verknüpftem Konto nur
   lesend (Account-Abfragen v1 + v2). Keine POST-Onboarding-/Callback-/Checkout-
   Route verwenden. Anfragezeit und Stripe-Request-Metadaten im richtigen LIVE-Konto
   mit dem finalen Key korrelieren; keine Kunden-/Accountdaten in Git protokollieren.
   Ohne geeignetes freigegebenes Konto/lesenden Nachweis stoppen, keinen Checkout
   oder eine Kündigung zum Erzeugen eines Nachweises durchführen.
6. App-Mail-Nachweis benötigt eine **gesondert genehmigte echte Zustellprobe**:
   bestehender geschützter POST `/api/admin/email-test`, ausschließlich
   `delivered@resend.dev`. Frischen Resend-Requestlog mit finalem Key korrelieren.
   Wiederholung am selben UTC-Tag kann dieselbe Email-ID zurückgeben; deshalb
   Requestlog/Key-Zuordnung prüfen, nicht nur einen alten „Delivered“-Eintrag.
   Keine Secret-Header, Empfängerinhalte oder Nachrichtentexte ausgeben.
7. Nur nach erfolgreichem neuen Runtime-Nachweis und eigener Freigabe die genaue
   Alt-Key-Liste widerrufen: alter Stripe-App-Key, vor A exponierter Stripe-v2-Key
   sowie alle sonstigen für Altcode erreichbaren LIVE-Schlüssel; bei Resend alter
   `Ardore-Production-2`, vor A exponierter `Ardore Hostinger Mail v2` und weitere
   nachgewiesen altprozessfähige Keys. Historische Kandidaten zusätzlich:
   Stripe-Standardkey; Resend `Ardore-Production`, `Ardore_Hostinger`, `Onboarding`.
   Ihre aktuellen IDs/Mitverbraucher vor Einzelwiderruf auflösen. Keiner ist durch
   diesen Plan zum Löschen freigegeben. Auth-SMTP-v2 nicht pauschal widerrufen.
8. Widerrufsstatus und letzte Requests nur anhand Provider-Metadaten bestätigen.
   Keine absichtliche LIVE-Kündigung/Erstattung als Negativtest. Bereits vor
   Widerruf angenommene Stripe-/Mail-Operationen und offene Recovery-Vorgänge
   abgleichen; Widerruf nimmt sie nicht zurück. Bei Fehler kein alter Key zurück.

## Benachrichtigungsbestand und Abgleich

Nur lesende Momentaufnahme vom 9. November: alle drei Journale leer (jeweils
`total=0`, `processing=0`, `unresolved_attempted=0`, `held=0`):
`coaching_email_deliveries`, `group_reminder_deliveries`,
`session_notification_deliveries`. Unmittelbar nach A, vor dem Keywechsel und vor
Wiederaufnahme erneut prüfen. Keine Empfänger, Payloads oder Kundendaten exportieren.

Nach A sind vier Claim-RPCs gesperrt: `claim_coaching_email`,
`claim_group_reminder`, `claim_current_group_reminder`, `claim_session_notification`.
Letztere pausiert auch die zugehörigen In-App-Kanäle. Bereits geclaimte Worker
können noch senden und ihren Abschluss melden; Lease-Ablauf ist kein Nachweis,
dass ein Provider nichts angenommen hat. Direkte Kauf-/Chat-/Bestätigungsmails,
Stripe-Webhook-/Recovery-Arbeit und Auth-SMTP sind nicht vollständig pausiert.

Abgleich nur anhand Zustand/Attempt-Zeit/Provider-Metadaten, ohne Journaländerung:

| Zustand | Sichere Behandlung vor Wiederaufnahme |
| --- | --- |
| `pending`, `first_attempt_at IS NULL` | Noch kein protokollierter Sendeversuch; normale Worker prüfen später erneut Berechtigung/Termin. Nicht pauschal manuell senden. |
| `processing`, Lease aktiv oder abgelaufen | Providerannahme klären; laufende Worker berücksichtigen. Weder Lease löschen noch automatisch zurücksetzen. |
| `pending` mit Versuch oder `held` | Unklarer früherer Versand kann beim Keywechsel dupliziert werden. Einzeln klären; sonst Pause beibehalten. |
| `sent` / `legacy_skipped` | Erhalten; nicht erneut senden. `sent` bestätigt nicht automatisch Inbox-Zustellung. |

Resend dokumentiert 24 Stunden Idempotenz; der lokale Schutz hält unklare
E-Mail-Versuche nach 23 Stunden zurück. Die geprüfte Dokumentation garantiert
keinen Umfang über verschiedene API-Keys hinweg. Deshalb vor Schlüsselwechsel
alle versuchten offenen Mailaufträge klären. Keine neuen Idempotenzschlüssel,
kein Payload-Umschreiben, kein pauschales `held`→`pending`, keine Blind-Wiederholung.
Fehlender Providerlog ist allein kein Beweis, dass nichts angenommen wurde.
Erforderliche Journalkorrekturen separat exakt vorbereiten und genehmigen lassen.

## Wiederaufnahme — bevorzugter Weg und Abbruchalternative

**Standard:** Nach nachgewiesenem C die drei Reparaturmigrationen D einzeln nach
eigener Freigabe anwenden/prüfen. Vor Storage-Reparatur die neue Storage-Systemversion
berücksichtigen. Anschließend E separat genehmigen: die vorhandene Aktivierungsdatei
prüft DB-Voraussetzungen und setzt Löschung frei sowie Claims-Pause auf `false`.
Sie beweist weder neue Runtime-Keys noch erledigten Providerabgleich; beides vorher.

Bestehende GitHub-Crons laufen alle zehn Minuten für Reminder/Review-/Lifecycle-
Versand und Payment-Recovery; Cleanup um 09:00 UTC. Während Claim-Pause können
Mail-Schritte als Fehler erscheinen. Workflow/CRON_SECRET nicht ändern und keinen
manuellen Cron starten: diese Endpunkte senden und Recovery kann Finanzaktionen
ausführen. Nach genehmigter Wiederaufnahme den nächsten regulären Lauf beobachten,
Status und `failed`/`busy`/`held` auswerten. HTTP 2xx allein ist kein Inbox-Nachweis.
Keine versäumten/abgelaufenen Reminder künstlich rückdatieren oder nachfüllen.

**Falls D/E nicht zeitnah möglich sind:** Nicht E nur für E-Mail öffnen. Eine
notification-only-Forward-Migration müsste separat erstellt, lokal gegen Gate +
Worker geprüft und genehmigt werden. Sie dürfte nur Claims freigeben, während
`enabled=false`, Hook und Löschschutz unverändert bleiben, und bräuchte denselben
Provider-/Attempt-Abgleich. Diese Alternative ist noch keine geprüfte ausführbare
SQL-Datei. Ohne abgesicherten Standard-Fortgang oder solche geprüfte Alternative
A nicht starten. Keine unbefristete Claim-Pause als funktionierenden Launch ausgeben.

## Noch erforderliche Freigaben/Nachweise

- Aktuelle finale Provider-IDs und Mitverbraucher vor Wartung aufnehmen; Dashboard-
  Zugang bei Stripe/Resend bei Bedarf herstellen, keine Werte zeigen.
- A + B mit endgültigem grünen Featurebranch-Head und Wartungswirkung freigeben.
- C: zwei finale App-Keys nach A/B, sichere Einzeländerungen, kontrolliertes
  Neuladen und definierte Zustellprobe gesondert freigeben; danach benannte Altkeys
  je Provider gesondert zum Widerruf freigeben. Gegenwärtig nichts davon ausführen.
- D und E bzw. notification-only-Alternative separat freigeben. Owner bleibt
  während Wartung erreichbar; vor A Zeitpunkt und gewünschten Fortgang festlegen.

Quellen: [Resend-Idempotenz](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Resend-Keyverwaltung](https://resend.com/docs/dashboard/api-keys/introduction),
[Stripe-Schlüssel](https://docs.stripe.com/keys).
Quellprüfung: `src/lib/email/index.ts`, `src/lib/coaching-emails.ts`,
`src/lib/session-cron.ts`, `src/app/api/stripe/connect/route.ts`,
`src/lib/stripe/connect-readiness.ts`, bestehende Claim-/Gate-/Aktivierungsmigrationen.
49 lokale Mail-/Reminder-/Cron-Tests mit Fixtures bestanden; keine Provideraufrufe.

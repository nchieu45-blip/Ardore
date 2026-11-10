# Erinnerungs- und Lifecycle-Mails wieder aufnehmen

Die gezielte Migration `20261110115655_resume_notification_dispatch_only.sql`
ändert ausschließlich `notification_dispatch_paused` auf `false`.
Kontolöschung bleibt geschlossen, Hook, Trigger, Rechte und Versandjournale bleiben
erhalten. Die vorhandene vollständige Aktivierung der Kontolöschung dafür nicht
verwenden. Bei bereits aktivem Versand ist die Migration eine wirkungslose Wiederholung,
auch nach einer vollständigen Neuinstallation.

Vor produktiver Anwendung müssen der separate Providerwechsel, die Verwendung der
neuen Schlüssel durch Hostinger und die Stilllegung der konkret freigegebenen alten
Schlüssel nachgewiesen sein. Diese Datei ersetzt diese externen Nachweise nicht.
Die neue Migration ist einzeln freizugeben; keine anderen offenen Migrationen anwenden.

Der zuletzt lesend geprüfte Produktionsstand am 10. November 2026: alle drei
Versandjournale leer, Kontolöschung geschlossen, Versand pausiert. Vor Anwendung
erneut prüfen. Die Migration sperrt die Journale während ihrer atomaren Prüfung
und lehnt laufende, zurückgehaltene sowie bereits versuchte offene Aufträge ab.
Keine Leases löschen, Payloads umschreiben oder Idempotenzschlüssel ändern.

Lokale Prüfung:

```sh
node scripts/test-isolated-account-deletion-release.mjs --run-isolated --notification-resume
node --test scripts/verify-session-crons.mjs scripts/verify-group-session-reminders.mjs scripts/verify-coaching-emails.mjs
```

Der erste Runner verwendet ausschließlich eine eigene lokale Wegwerf-Datenbank.
Er prüft neun mehrdeutige Journalzustände, vier Claim-Endpunkte, Rollen, unverändert
gesperrte Altzugriffe/Kontolöschung sowie Wiederholung und Neuinstallation. Danach
laufen die vorhandenen Datenbank- und Paralleltests. Provider sind dort simuliert;
das ist kein Nachweis echter E-Mail-Zustellung.

Nach separat freigegebener Anwendung: `enabled=false` und
`notification_dispatch_paused=false`, Trigger/Hook unverändert und Journalzustände
prüfen. Die bestehenden regulären Zehn-Minuten-Läufe beobachten. Falls eine gezielte
Versandprobe freigegeben wird, nur die geprüften Mail-Endpunkte verwenden:
`/api/cron/session-reminders` (1:1, Gruppen, Lifecycle) und
`/api/cron/session-review-prompts`. Keinen gesamten Workflow manuell auslösen:
dieser enthält auch Zahlungs-Recovery und Dokumentlöschung.

Für einen echten Zustellnachweis werden eigene konkret freigegebene Testtermine und
Empfänger benötigt. Zwei Wiederholungen müssen dieselben Journaleinträge und
Provider-IDs behalten. `sent` oder HTTP 200 allein belegen keine Inbox-Zustellung.
Falls keine fälligen Buchungen vorliegen, einen leeren Cron-Lauf als solchen melden.
Keine abgelaufenen Reminder rückdatieren oder nachträglich massenhaft senden.

Bei unklarem Versandzustand Pause gezielt wieder setzen, keine Journale zurücksetzen.
Produktive Änderungen und Tests nur im konkret freigegebenen Umfang ausführen.

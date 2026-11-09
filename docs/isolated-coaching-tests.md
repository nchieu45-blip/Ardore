# Isolierte kostenpflichtige Coaching-Tests

Der gesamte Ablauf aus Stripe-Testzahlung, Bestätigungsmails und Daily-Anruf ist
für 1:1- und Gruppenbuchungen in einer ausdrücklich freigeschalteten lokalen
Testumgebung verfügbar. Der Zahlungsvorgang und seine signierten Webhooks bleiben
unverändert. Eine Stripe-Rückkehr oder eine offene Zahlung bestätigt keine Buchung.

## Freischaltung

Alle folgenden Bedingungen müssen gleichzeitig erfüllt sein:

- `ARDORE_ISOLATED_COACHING_TESTS=1` als private Servervariable.
- `NODE_ENV=development` oder `test`; `next start`/Produktionsbuilds können die
  Ausnahme ausdrücklich nicht verwenden.
- `NEXT_PUBLIC_APP_URL` und `NEXT_PUBLIC_SUPABASE_URL` sind HTTP-Adressen auf
  `127.0.0.1`, `localhost` oder `[::1]`, jeweils mit explizitem Port, ohne Pfad,
  Zugangsdaten, Query oder Fragment.
- Der private Stripe-Schlüssel ist ein `sk_test_`- oder `rk_test_`-Schlüssel und
  der öffentliche Schlüssel beginnt mit `pk_test_`.

Beispiel ohne Zugangsdaten:

```env
ARDORE_ISOLATED_COACHING_TESTS=1
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3032
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55131
```

Die lokale Supabase-Adresse muss ausschließlich auf eine eigene Wegwerf-Datenbank
zeigen. Keine Weiterleitung auf Produktion. Eigene lokale JWT-Schlüssel verwenden;
Testakteure nur über die GoTrue Admin API anlegen. Ein Schema-Abzug darf keine
Bestandskunden, Buchungen oder anderen Anwendungsdaten übernehmen. Migrationen
müssen den geprüften Quellstand abbilden.

Bei jeder fehlenden oder ungültigen Bedingung bleibt die bisherige LIVE-Prüfung
aktiv. In der ausdrücklich isolierten Umgebung werden ausschließlich TEST-Zahlungen
anerkannt; LIVE-Buchungen werden dort nicht als bezahlte Teilnahme freigegeben.
Der Browser kann weder per Formular noch Header oder Query diesen Modus setzen.
Produkt-, Abo- und Umsatzberechtigungen bleiben bei ihren bestehenden Regeln.

## Prüfablauf

1. Separaten temporären App-Ordner, lokale Auth-/REST-Instanzen und eigene
   Datenbank anlegen. Nur diese App mit der Freischaltung starten (`next dev`).
2. Das ausgewählte Stripe-Sandbox-Konto und den TEST-Modus vor Mutationen prüfen.
   Synthetischen TEST-Coach mit dem vorhandenen Fixture-Helper vorbereiten.
3. Eigene 1:1- und Gruppenangebote sowie Coach/Kunde anlegen. Über die tatsächliche
   Buchungsoberfläche buchen und den gehosteten Stripe-Checkout mit Testdaten bezahlen.
4. Stripe CLI leitet signierte Ereignisse auf die lokale `/api/webhooks/stripe`
   weiter. Erfassung, bestätigte Buchungen, Sitzplatz und 90/10-Verteilung prüfen.
5. Genau vier freigegebene Bestätigungsmails an die Test-Aliase des Ardore-Postfachs
   senden lassen: Kunde und Coach für beide Buchungen. Tatsächlichen Empfang,
   Termine und Empfänger prüfen. Kein Daily-Token darf in einer Mail stehen.
6. Innerhalb des normalen Zeitfensters aus den tatsächlichen bezahlten
   Buchungen beitreten. Beide Rollen und gegenseitige Bild-/Tonübertragung prüfen.
   Authentifizierung, Besitzerrechte, Erstattungsstatus und Terminprüfung gelten
   weiterhin; Gruppen benötigen konsistente bestätigte Zahlungsreferenzen.
7. Abschlussereignisse wiederholen: keine zusätzliche Buchung, kein zusätzlicher
   Platz, keine zusätzlichen Bestätigungsmails. Fehlende/ungültige Freischaltung,
   Produktionsstart, fremde Identität und ungültige Zahlungszustände negativ testen.

Provider-Schlüssel niemals protokollieren oder einchecken. Ein vorhandener
Produktions-Sendeschlüssel darf nur im konkret freigegebenen Umfang kopiert werden.
Für spätere wiederholte Tests einen separat eingeschränkten Test-Sendeschlüssel
verwenden. Keine neuen Produktionsschlüssel oder Konfigurationsänderungen sind
durch diesen Modus erforderlich.

Nach der Prüfung zuerst App und Webhook-Weiterleitung stoppen bzw. den Sendeschlüssel
entfernen. Eigene TEST-Zahlungen erstatten und zugehörige Transfers zurücknehmen,
synthetischen TEST-Coach schließen, eigene Daily-Räume entfernen und ausschließlich
die eigenen lokalen Testressourcen inklusive temporärer Schlüssel löschen. Stripe
behält unveränderliche TEST-Zahlungshistorie. Kein Produktions-Cron wird ausgelöst.

## Release

Dieser Anwendungscode benötigt keine Migration und keine Produktionsvariable.
Die Freischaltung wird bei Hostinger nicht gesetzt. Die normalen geschützten
1:1-/Gruppen-Zugangsprüfungen bleiben dort auf bestätigte LIVE-Zahlungen begrenzt.
Vor Merge/Deployment die Regressionstests, vollständigen isolierten Ablauf und
Node-22-CI für die konkrete Revision prüfen.

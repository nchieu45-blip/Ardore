# Ardore: Bildstandard und Upload-Leitfaden

Stand: 6. Oktober 2026. Gilt für den bestehenden visuellen Pilot: CoachCard, ProductCard, Jonas-Weber-Storefront und Coach-Arbeitsbereich. Kein Homepage-Redesign, keine Erweiterung der Identität auf andere Seiten. Bilder ergänzen Ardore; sie ersetzen weder klare Titel, Preise noch die Identität des Coaches.

## Schnellübersicht

| Verwendung | Ausschnitt | Empfohlen | Mindestqualität im sichtbaren Ausschnitt | Export-Ziel | Aktuelles Upload-Limit |
|---|---|---|---|---|---|
| Coach-Portrait | 4:5 | 1200 × 1500 px | 800 × 1000 px | 200–500 KB | 5 MiB |
| Rundavatar | zentraler quadratischer Ausschnitt desselben Portraits | kein separater Upload | Gesicht auch bei 24–80 px erkennbar | vom Portrait abgeleitet, keine eigene Datei nötig | Portrait-Limit |
| Produktcover | 16:9 | 1600 × 900 px | 800 × 450 px | 150–400 KB | 10 MiB |
| Optionales Creator-Banner | Quelle 4:1 | 2400 × 600 px | 1200 × 300 px | 200–600 KB | 10 MiB |
| Künftiges Kategorie-Bild | Quelle 4:3; Ausschnitt je künftiger Oberfläche prüfen | 1200 × 900 px | 800 × 600 px | 150–350 KB | noch kein Kategorie-Upload |
| Künftige Hero-Szene | flexible Quelle, separat geprüfter mobiler Ausschnitt | 2400 × 1600 px | 1600 × 1067 px | möglichst unter 600 KB | noch kein Hero-Upload |

Die Mindestmaße sind Qualitäts-Empfehlungen, keine neuen Veröffentlichungsbedingungen. Bei extrem breiten/hohen Originalen zählt die Auflösung **nach** dem mittigen Ausschnitt. Ein 1600 × 900 px breites Foto ergibt beispielsweise nur 720 × 900 px im 4:5-Portrait. Bestehende Bilder werden weder abgelehnt noch neu zugeschnitten oder ersetzt.

## 1. Coach-Portrait

Zeige die reale Person, die die Leistung anbietet. Natürliches weiches Licht, eine ruhige reale Umgebung und normale Arbeits-/Alltagskleidung. Aufrechte, entspannte Haltung; Gesicht und Augen gut sichtbar. Das kann ein Trainer im Studio, eine Ernährungsberaterin in einer ruhigen Küche oder ein Coach im Beratungsraum sein. Keine steifen Business-Porträts nötig, aber auch keine extremen Muskel-/Body-Transformationen als Standard.

- Quelle bevorzugt bereits 4:5. Kopf, Schultern und etwas Umgebung; nicht nur ein eng angeschnittenes Gesicht.
- Zentrierte Anzeige: `object-fit: cover; object-position: center`. Es gibt derzeit keine individuelle Fokuspunkt-Speicherung und keinen Bildeditor.
- Gesicht horizontal nahe der Mitte. Augen ungefähr bei 35–45 % der Bildhöhe. Kopf und Gesicht im zentralen Bereich halten; mindestens 10 % Luft über dem Kopf und seitlich. Keine wesentlichen Details in den äußeren 10 %.
- Für den Rundavatar wird aus dem 4:5-Bild der mittlere quadratische Bereich verwendet, danach der Kreis maskiert. Gesicht deshalb im zentralen Quadrat halten; Kopf und Kinn nicht an dessen Rand setzen. Die Upload-Vorschau zeigt beide Formen.
- Keine starke Beauty-Retusche, künstlichen Hintergründe, AI-Gesichter, Filter, Qualifikationssticker oder eingebrannten Bewertungssterne.
- Auf Mobilgeräten bleibt das Card-Portrait 4:5; der Pilot-Storefront zeigt ein kleineres 4:5-Portrait. Der Ausschnitt bleibt mittig statt zwischen Breakpoints zu springen.
- Fehlendes/defektes Bild: vorhandener neutraler Personen-Fallback. Keine fremde Person und kein zufälliges Stockfoto als Ersatz.

## 2. Avatar und Wiedererkennung

Ardore nutzt `creator_profiles.avatar_url` sowohl für Portrait als auch für den Rundavatar. ProductCard-Zuordnung und Coach-Workspace verwenden dieses Creator-Portrait. Die Navigation nutzt dagegen derzeit den separaten Kontoavatar (`profiles.avatar_url`); beide Bilder werden nicht automatisch synchronisiert. Für Wiedererkennung dort dieselbe reale Person/dasselbe geeignete Portrait wählen, wenn ein Kontoavatar gepflegt wird. Dieser Auftrag ändert keine Daten oder Avatar-Quellen in der Navigation. Kleine Avatare benötigen klare Konturen und ausreichend Kontrast; Details, Text oder ein Logo statt Gesicht sind meist schlechter erkennbar.

Auf tatsächlichen Buchungs-/Sessionflächen bestehende Avatar-Verwendungen beibehalten; keine neue Fotopflicht oder andere Zugriffserlaubnis. Käufer-/Nutzeravatare im separaten `avatars`-Bucket bleiben unverändert. Fehlende/defekte Rundbilder zeigen die bestehenden Namensinitialen. Der ausgeschriebene Creator-Name bleibt auch auf Mobilgeräten sichtbar und darf durch Bilder nicht ersetzt werden.

## 3. Produktcover

Ein Cover stellt die konkrete Arbeit des Creators vor, nicht den Dateityp. Ein Trainingsplan darf die betreffende Bewegung oder reale Materialien zeigen; ein Ernährungs-Guide passende reale Zutaten oder Zubereitung; ein Kurs einen eigenen sachlich passenden Videoausschnitt. Für ein Programm ist eine reduzierte eigene Grafik zulässig, wenn sie den tatsächlichen Inhalt erklärt. Keine fingierten Resultate.

- 16:9: 1600 × 900 px empfohlen, 800 × 450 px minimum im sichtbaren Bereich.
- Ein Hauptmotiv, ruhige Nebenflächen, keine Collage aus vielen winzigen Bildern. Eigene oder nachweislich nutzbare Assets; keine Wettbewerber-Assets.
- Motiv und Text im mittleren 80 % der Breite/Höhe. Oben rechts etwa 15 % für den Favoriten-Button freilassen; keine Gesichter/Schrift unter diesem UI-Element.
- Idealerweise kein eingebrannter Text. Falls nötig: höchstens eine kurze Zeile mit etwa 3–6 Wörtern, höchstens ungefähr 20 % der Bildfläche. Produktname, Umfang, Preis und Creator stehen als zugänglicher UI-Text außerhalb des Bilds.
- Keine Rabattsiegel, erfundenen Sterne, Bestseller-Labels, PDF-Symbole als riesiges Hauptmotiv oder durch Bilder behauptete Verifikation.
- Creator kann eine eigene wiederkehrende Cover-Gestaltung nutzen: ähnliche Lichtstimmung, Farbtemperatur und Typografie **innerhalb des Bilds**, ohne Ardore-UI-Styles zu verändern. Nicht das komplette Produktlayout im Cover nachbauen.
- JPEG/WEBP für Fotos; PNG für Grafiken mit feinen Linien oder nötiger Transparenz. Export in sRGB, moderate Kompression (Foto etwa Qualität 80–85 als Ausgangspunkt), am Handy auf Lesbarkeit prüfen.
- Für Abonnements nur ein echtes sinnvoll zugehöriges Bild nutzen, wenn die bestehende Oberfläche das unterstützt. Aktuell gibt es kein eigenes Abo-Cover-Feld; kein neues Feld/Upload oder erfundenes Foto hinzugefügt.
- Fehlendes/defektes Cover: vorhandene ruhige neutrale Bildfläche. Titel, Format, Creator und Preis erklären das Angebot weiterhin. Keine zufällige Themenfotografie als permanenter Ersatz.

## 4. Creator-Personalisierung

Erlaubte bestehende Mittel: reales Portrait, optionales eigenes Banner, eigene Produktcover und vorhandene normalisierte Social-/Website-Links. Keine freien UI-Schriften, Farben, Button-Styles, HTML oder Layout-Einstellungen. Geist, Ardore-Grün, Radien, Borders und UI-Hierarchie bleiben zentral.

Banner-Quelle 4:1; in bestehenden Profilen wird je nach Breite/Höhe ein anderer mittiger Ausschnitt sichtbar. Deshalb wichtige Motive im zentralen Bereich halten, keine wesentliche Schrift im Banner. Das Banner ist optional, kein Pflichtfeld. Der Jonas-Storefront-Pilot verwendet derzeit sein Portrait und **zeigt keinen Banner**; die gespeicherte Bannerdatei bleibt für bestehende Ansichten erhalten. Dieses Dokument aktiviert keine neue Banner-Komposition im Pilot.

## 5. Künftige Kategorie- und Hero-Bilder

**Nur Orientierung, noch keine Umsetzung:** Kategorien wie Fitness, Ernährung oder Mobilität können mit realen, thematisch korrekten Tätigkeiten unterstützt werden. Ähnliche Lichtstimmung und Bildqualität, keine Regenbogen-Kategoriepalette, keine Körperideal-Versprechen. Ausgangsformat 4:3, finalen Ausschnitt erst mit der späteren tatsächlichen Komponente festlegen. Bilder dürfen weder Seitenstruktur noch Kategorie-Auswahl bestimmen. Keine übernommenen Konkurrenz-Kompositionen.

Für eine künftige Hero-Szene: eine starke echte Coaching-/Alltagssituation mit natürlicher Handlung; Personen mit Einverständnis, natürliche Vielfalt statt inszenierter Statistik. Mobile separat kuratieren. Bei Textüberlagerung ausreichende ruhige freie Fläche und geprüfter Textkontrast; wichtige Motive nicht unter Text legen. Keine Stethoskop-/Klinik-Klischees, Corporate-Wellness-Handschlagbilder oder imitierte Konkurrenz-Heros. Die aktuelle Homepage bleibt unverändert.

## 6. Vorbereitung vor dem Upload

1. Nur ein reales, zum eigenen Angebot gehörendes Bild auswählen; Rechte/Einverständnis für öffentliche Nutzung klären.
2. Auf das empfohlene Format exportieren; Gesicht/Motiv im sicheren zentralen Bereich halten.
3. JPEG/WEBP/PNG bevorzugen. HEIC bei Bedarf vorab in JPEG/WEBP exportieren; SVG und Animationen sind kein empfohlener Fotostandard.
4. Kompression prüfen. Zielgrößen aus der Tabelle sind Empfehlungen, nicht das technische Upload-Limit.
5. Private EXIF-/Standortdaten vorab entfernen; Ardore entfernt Metadaten des gespeicherten Originals derzeit nicht automatisch.
6. In Ardore den 4:5- und Rund-Ausschnitt beziehungsweise 16:9-Cover prüfen. Hinweise auf geringe Auflösung/großen Beschnitt berücksichtigen.
7. Bild erst über den bestehenden Speichern-/Upload-Flow veröffentlichen. Die Vorschau allein speichert oder transformiert nichts.

Beispiele: Ein entspanntes Schulterporträt vor einer echten neutralen Wand; ein eigener Yogakurs-Ausschnitt mit ausreichend Raum um die Bewegung; ein Guide-Cover mit einer einzelnen realen Zubereitungsszene. Nicht: erfundener Coach, fremdes Stockporträt als Identität, überladene Textposter oder Rabatt-/Trust-Sticker.

## 7. Technischer Pipeline-Audit

Rein lesend am 6. Oktober 2026 gegen die Produktionskonfiguration geprüft:

| Inhalt | Speicherung / Pfad | Verhalten |
|---|---|---|
| Creator-Portrait / Banner | öffentlicher Bucket `profile-images`, `<creator-id>/avatar` / `<creator-id>/banner` | vorhandener Upsert; URL mit Cache-Busting; Originaldatei bleibt unverändert |
| Produktcover | öffentlicher Bucket `thumbnails`, Creator-ID-Namespace mit bestehender Dateibenennung | neue Datei ohne Upsert, `products.thumbnail_url` übernimmt öffentliche URL |
| Nutzeravatar | öffentlicher Bucket `avatars`, User-ID-Namespace | separate bestehende Pipeline, nicht umgebaut |

Client-Limits: Portrait 5 MiB, Banner 10 MiB, Cover 10 MiB. Profil/Onboarding akzeptieren bisher MIME `image/*`; Cover erlauben `image/jpeg`, `image/png`, `image/webp`. Diese Auswahl wurde nicht erweitert oder für Legacy-Assets rückwirkend eingeschränkt. Browser-`accept` und Clientchecks sind **keine serverseitige Inhaltsvalidierung**.

Die drei Buckets haben aktuell `file_size_limit = NULL` und `allowed_mime_types = NULL`. Das bedeutet keine individuell gesetzten Bucket-Limits, nicht unbegrenzten Storage: globale Projekt-/Storage-Limits gelten weiterhin und wurden nicht verändert. Der definierte Standard ist deshalb keine Behauptung, dass serverseitig exakt diese Dateigrößen oder MIME-Typen erzwungen werden. Eine spätere Bucket-Härtung wäre eine separate Konfigurationsentscheidung; hier keine RLS-/Auth-/Storage-Änderung.

Eigentum: Creator-Uploads müssen laut aktiven `storage.objects`-Policies im eigenen Creator-ID-Verzeichnis liegen; `profile-images`-UPDATE prüft Eigentum sowohl in USING als auch WITH CHECK. Nutzeravatare liegen im eigenen User-ID-Verzeichnis. Öffentliches Lesen gilt für Marketingbilder; niemals vertrauliche Dokumente in diese Buckets hochladen. Der Onboarding-Endpunkt akzeptiert nur eigene `profile-images`-URLs; Produkt-/Profilwrites behalten bestehende Eigentums-/Feldschutzregeln. Keine Policies entfernt/erweitert.

Keine Upload-Neuskalierung, kein persistierter Crop/Fokuspunkt, kein EXIF-Strip. Next.js Image optimiert bei der **Anzeige** der Pilotbilder, mit reserviertem Seitenverhältnis, `sizes`, lazy loading und eingeschränkter HTTPS-Supabase-URL-Allowlist. Next-Optimierung ersetzt keine Bereinigung/Verkleinerung der gespeicherten Originaldatei. Lokale Upload-Vorschauen nutzen native `img` für Object-URLs.

## 8. Kleine Implementierungen

- Gemeinsame Upload-Hinweise und mittige Ausschnitt-Vorschauen für Portrait + Rundavatar, Produktcover und Banner.
- Natürliche Bildmaße werden lokal gelesen; zu kleiner effektiver Ausschnitt und ungewöhnliches Seitenverhältnis erzeugen **beratende** Hinweise. Kein neuer Veröffentlichungsblocker, keine erzwungene Neuskalierung.
- Produkt-Uploadvorschau auf echtes 16:9 statt fixer Höhe gebracht.
- Mittelpunkt explizit in vorhandenen Media-/Avatar-Komponenten; entspricht dem bisherigen Default.
- Bei neu gewählten Profilbildern alte lokale Object-URLs freigegeben.
- Kein Crop-Editor, keine neuen Markenmotive, keine Produktionsbilder ersetzt.

Zum Auditzeitpunkt: 0 öffentliche Portraits, 0 öffentliche Banner, 0 öffentliche Produktcover. Alle Produktions-Fallbacks bleiben erhalten. Für geometrische Tests ausschließlich deutlich bezeichnete lokale Kalibrierbilder ohne Personen verwenden; solche Fixtures sind keine Launch-Assets und werden nicht in Storage hochgeladen.

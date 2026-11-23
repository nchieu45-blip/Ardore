# Hintergrundvideo der Startseite

Lege hier zwei stumme, nahtlos geschnittene Varianten derselben 10–14 Sekunden langen Szene ab.

| Ausschnitt | WebM (VP9 oder AV1) | MP4 (H.264, Fast Start) | Ziel je Datei |
| --- | --- | --- | --- |
| Desktop, bis 1920 × 1080 | desktop.webm | desktop.mp4 | unter 4 MB |
| Mobil, z. B. 720 × 900 (4:5) | mobile.webm | mobile.mp4 | unter 2 MB |

Ersetze `poster.webp` durch den ersten Frame des finalen Clips. Wähle einen Ausschnitt, der auch im schmalen Hero funktioniert. Bis dahin dient eine mit ImageGen erstellte Coaching-Szene als Poster.

Beim nächsten Build wird jeder Ausschnitt mit beiden vorhandenen Formaten automatisch aktiviert. Mobil gilt bis einschließlich 767 CSS-Pixel. Prüfe mit den finalen Dateien Loop-Übergang, Bildausschnitt, mobile Lighthouse-Wertung und LCP.

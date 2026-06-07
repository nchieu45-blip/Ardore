const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health'

function layout(content: string) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ardore</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <!-- Logo -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <span style="font-size:22px;font-weight:700;color:#16a34a;">🔥 Ardore</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding-top:24px;text-align:center;font-size:12px;color:#9ca3af;">
          © 2026 Ardore · <a href="${APP_URL}" style="color:#9ca3af;">ardore.health</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#16a34a;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">${label}</a>`
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;" />`
}

// ─── Purchase receipt ────────────────────────────────────────────────────────

export interface PurchaseReceiptData {
  buyerName: string
  productTitle: string
  amountPaid: number
  creatorName: string
  libraryUrl: string
}

export function purchaseReceiptHtml(d: PurchaseReceiptData) {
  const amount = `${d.amountPaid.toFixed(2).replace('.', ',')} €`
  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Dein Kauf war erfolgreich! 🎉</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Danke, ${d.buyerName}. Hier ist deine Kaufbestätigung.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Produkt</td>
        <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;padding-bottom:6px;">${d.productTitle}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Anbieter</td>
        <td style="font-size:13px;color:#111827;text-align:right;padding-bottom:6px;">${d.creatorName}</td>
      </tr>
      ${divider()}
      <tr>
        <td style="font-size:14px;font-weight:700;color:#111827;">Gesamt</td>
        <td style="font-size:14px;font-weight:700;color:#16a34a;text-align:right;">${amount}</td>
      </tr>
    </table>
    <p style="text-align:center;margin:0 0 20px;">${button(d.libraryUrl, 'Zur Bibliothek →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Fragen? Schreib uns einfach zurück.
    </p>
  `)
}

export function purchaseReceiptText(d: PurchaseReceiptData) {
  return `Hallo ${d.buyerName},\n\nDu hast erfolgreich "${d.productTitle}" von ${d.creatorName} für ${d.amountPaid.toFixed(2)} € gekauft.\n\nZur Bibliothek: ${d.libraryUrl}\n\n– Das Ardore-Team`
}

// ─── New subscriber notification ────────────────────────────────────────────

export interface NewSubscriberData {
  creatorName: string
  subscriberName: string
  tierName: string
  priceMonthly: number
  dashboardUrl: string
}

export function newSubscriberHtml(d: NewSubscriberData) {
  const price = d.priceMonthly === 0 ? 'Kostenlos' : `${d.priceMonthly} €/Monat`
  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Neuer Abonnent! 🎊</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hey ${d.creatorName}, du hast einen neuen Abonnenten.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Abonnent</td>
        <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;padding-bottom:6px;">${d.subscriberName}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#6b7280;">Abo-Stufe</td>
        <td style="font-size:13px;color:#111827;text-align:right;">${d.tierName} · ${price}</td>
      </tr>
    </table>
    <p style="text-align:center;margin:0 0 20px;">${button(d.dashboardUrl, 'Zum Dashboard →')}</p>
  `)
}

export function newSubscriberText(d: NewSubscriberData) {
  const price = d.priceMonthly === 0 ? 'kostenlos' : `${d.priceMonthly} €/Monat`
  return `Hey ${d.creatorName},\n\n${d.subscriberName} hat dein Abo "${d.tierName}" (${price}) abonniert.\n\nZum Dashboard: ${d.dashboardUrl}\n\n– Das Ardore-Team`
}

// ─── Chat message notification ───────────────────────────────────────────────

export interface ChatNotificationData {
  recipientName: string
  senderName: string
  messagePreview: string
  chatUrl: string
}

export function chatNotificationHtml(d: ChatNotificationData) {
  const preview = d.messagePreview.length > 120
    ? d.messagePreview.slice(0, 120) + '…'
    : d.messagePreview

  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Neue Nachricht 💬</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hey ${d.recipientName}, du hast eine neue Nachricht von <strong style="color:#111827;">${d.senderName}</strong>.</p>
    <blockquote style="margin:0 0 24px;padding:12px 16px;background:#f9fafb;border-left:3px solid #16a34a;border-radius:4px;font-size:14px;color:#374151;">
      "${preview}"
    </blockquote>
    <p style="text-align:center;margin:0 0 20px;">${button(d.chatUrl, 'Nachricht lesen →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Du erhältst diese E-Mail, weil du Nachrichten über Ardore empfängst.
    </p>
  `)
}

export function chatNotificationText(d: ChatNotificationData) {
  return `Hey ${d.recipientName},\n\n${d.senderName} hat dir geschrieben:\n\n"${d.messagePreview}"\n\nNachricht lesen: ${d.chatUrl}\n\n– Das Ardore-Team`
}

// ─── Booking confirmation ─────────────────────────────────────────────────────

export interface BookingConfirmationData {
  recipientName: string
  coachName: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  sessionUrl: string
  role: 'buyer' | 'creator'
}

export function bookingConfirmationHtml(d: BookingConfirmationData) {
  const isBuyer = d.role === 'buyer'
  const heading = isBuyer
    ? `Dein Videocoaching ist gebucht! 🎉`
    : `Neue Buchung von ${d.coachName} 📅`
  const intro = isBuyer
    ? `Hey ${d.recipientName}, deine Session mit <strong>${d.coachName}</strong> ist bestätigt.`
    : `Hey ${d.recipientName}, du hast eine neue Buchung erhalten.`

  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">${heading}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${intro}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">${isBuyer ? 'Dein Coach' : 'Kunde'}</td>
        <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;padding-bottom:8px;">${d.coachName}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Datum</td>
        <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;padding-bottom:8px;">${d.scheduledDate}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">Uhrzeit</td>
        <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;padding-bottom:8px;">${d.scheduledTime} Uhr</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#6b7280;">Dauer</td>
        <td style="font-size:13px;color:#111827;text-align:right;">${d.durationMinutes} Minuten</td>
      </tr>
    </table>
    <p style="text-align:center;margin:0 0 16px;">${button(d.sessionUrl, 'Zur Session →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Du erhältst den Link zum Videoraum kurz vor der Session per E-Mail.
    </p>
  `)
}

export function bookingConfirmationText(d: BookingConfirmationData) {
  const isBuyer = d.role === 'buyer'
  const other = isBuyer ? `Coach ${d.coachName}` : `Kunde ${d.coachName}`
  return `Hey ${d.recipientName},\n\nDeine Session mit ${other} ist bestätigt.\n\nDatum: ${d.scheduledDate}\nUhrzeit: ${d.scheduledTime} Uhr\nDauer: ${d.durationMinutes} Minuten\n\nSession-Link: ${d.sessionUrl}\n\n– Das Ardore-Team`
}

// ─── Session reminder ─────────────────────────────────────────────────────────

export interface SessionReminderData {
  recipientName: string
  coachName: string
  scheduledTime: string
  minutesUntil: number
  sessionUrl: string
}

export function sessionReminderHtml(d: SessionReminderData) {
  const timeLabel = d.minutesUntil <= 60 ? `in ${d.minutesUntil} Minuten` : `in ${Math.round(d.minutesUntil / 60)} Stunden`
  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Deine Session startet bald ⏰</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
      Hey ${d.recipientName}, deine Videocoaching-Session mit <strong>${d.coachName}</strong> beginnt ${timeLabel} um <strong>${d.scheduledTime} Uhr</strong>.
    </p>
    <p style="text-align:center;margin:0 0 20px;">${button(d.sessionUrl, 'Session beitreten →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Teste dein Mikrofon und deine Kamera vor der Session.
    </p>
  `)
}

export function sessionReminderText(d: SessionReminderData) {
  const timeLabel = d.minutesUntil <= 60 ? `in ${d.minutesUntil} Minuten` : `in ${Math.round(d.minutesUntil / 60)} Stunden`
  return `Hey ${d.recipientName},\n\nDeine Session mit ${d.coachName} beginnt ${timeLabel} um ${d.scheduledTime} Uhr.\n\nJetzt beitreten: ${d.sessionUrl}\n\n– Das Ardore-Team`
}

// ─── Account deletion notices ─────────────────────────────────────────────────

export interface BookingCancelledNoticeData {
  recipientName: string
  coachName:     string
  scheduledAt:   string
}

export function bookingCancelledNoticeHtml(d: BookingCancelledNoticeData) {
  const date = new Date(d.scheduledAt).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const time = new Date(d.scheduledAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Session wurde storniert</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      Hallo ${d.recipientName},<br><br>
      leider hat <strong>${d.coachName}</strong> sein Konto auf Ardore gelöscht. Deine gebuchte Session am
      <strong>${date} um ${time} Uhr</strong> wurde daher automatisch storniert.
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      Du findest andere Coaches auf Ardore:
    </p>
    <p style="text-align:center;margin:0 0 20px;">${button(`${APP_URL}/coaches`, 'Coaches entdecken →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Wir bedauern die Unannehmlichkeiten. Dein Ardore-Team
    </p>
  `)
}

export function bookingCancelledNoticeText(d: BookingCancelledNoticeData) {
  const date = new Date(d.scheduledAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = new Date(d.scheduledAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `Hallo ${d.recipientName},\n\nDeine Session mit ${d.coachName} am ${date} um ${time} Uhr wurde storniert, da der Coach sein Konto gelöscht hat.\n\nFinde andere Coaches: ${APP_URL}/coaches\n\n– Das Ardore-Team`
}

export interface SubscriptionCancelledNoticeData {
  recipientName: string
  coachName:     string
}

export function subscriptionCancelledNoticeHtml(d: SubscriptionCancelledNoticeData) {
  return layout(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Dein Abonnement wurde beendet</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      Hallo ${d.recipientName},<br><br>
      <strong>${d.coachName}</strong> hat sein Konto auf Ardore gelöscht. Dein aktives Abonnement wurde daher automatisch beendet.
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      Du findest viele andere Coaches auf Ardore, die dir weiterhelfen können:
    </p>
    <p style="text-align:center;margin:0 0 20px;">${button(`${APP_URL}/coaches`, 'Coaches entdecken →')}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Wir bedauern die Unannehmlichkeiten. Dein Ardore-Team
    </p>
  `)
}

export function subscriptionCancelledNoticeText(d: SubscriptionCancelledNoticeData) {
  return `Hallo ${d.recipientName},\n\n${d.coachName} hat sein Konto gelöscht. Dein Abonnement wurde automatisch beendet.\n\nFinde andere Coaches: ${APP_URL}/coaches\n\n– Das Ardore-Team`
}

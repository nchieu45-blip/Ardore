import { getResend, FROM } from './index'
import {
  purchaseReceiptHtml, purchaseReceiptText, PurchaseReceiptData,
  newSubscriberHtml, newSubscriberText, NewSubscriberData,
  chatNotificationHtml, chatNotificationText, ChatNotificationData,
  bookingConfirmationHtml, bookingConfirmationText, BookingConfirmationData,
  sessionReminderHtml, sessionReminderText, SessionReminderData,
} from './templates'

export async function sendPurchaseReceipt(to: string, data: PurchaseReceiptData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Kaufbestätigung: ${data.productTitle}`,
    html: purchaseReceiptHtml(data),
    text: purchaseReceiptText(data),
  })
}

export async function sendNewSubscriberNotification(to: string, data: NewSubscriberData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Neuer Abonnent: ${data.subscriberName} hat dein Abo gestartet`,
    html: newSubscriberHtml(data),
    text: newSubscriberText(data),
  })
}

export async function sendChatNotification(to: string, data: ChatNotificationData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Neue Nachricht von ${data.senderName}`,
    html: chatNotificationHtml(data),
    text: chatNotificationText(data),
  })
}

export async function sendBookingConfirmation(to: string, data: BookingConfirmationData) {
  const subject = data.role === 'buyer'
    ? `Buchungsbestätigung: Session mit ${data.coachName}`
    : `Neue Buchung: Session mit ${data.coachName}`
  await getResend().emails.send({
    from: FROM,
    to,
    subject,
    html: bookingConfirmationHtml(data),
    text: bookingConfirmationText(data),
  })
}

export async function sendSessionReminder(to: string, data: SessionReminderData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Session-Erinnerung: ${data.minutesUntil <= 60 ? `in ${data.minutesUntil} Min.` : 'morgen'} mit ${data.coachName}`,
    html: sessionReminderHtml(data),
    text: sessionReminderText(data),
  })
}

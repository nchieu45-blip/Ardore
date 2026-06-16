import { getResend, FROM } from './index'
import {
  purchaseReceiptHtml, purchaseReceiptText, PurchaseReceiptData,
  newSubscriberHtml, newSubscriberText, NewSubscriberData,
  chatNotificationHtml, chatNotificationText, ChatNotificationData,
  bookingConfirmationHtml, bookingConfirmationText, BookingConfirmationData,
  sessionReminderHtml, sessionReminderText, SessionReminderData,
  bookingCancelledNoticeHtml, bookingCancelledNoticeText, BookingCancelledNoticeData,
  subscriptionCancelledNoticeHtml, subscriptionCancelledNoticeText, SubscriptionCancelledNoticeData,
  sessionReviewPromptHtml, sessionReviewPromptText, SessionReviewPromptData,
  rescheduleConfirmationHtml, rescheduleConfirmationText, RescheduleConfirmationData,
  sessionCancellationHtml, sessionCancellationText, SessionCancellationData,
  videoClassConfirmationHtml, videoClassConfirmationText, VideoClassConfirmationData,
  videoClassNewParticipantHtml, videoClassNewParticipantText, VideoClassNewParticipantData,
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

export async function sendBookingCancelledNotice(to: string, data: BookingCancelledNoticeData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Deine Session mit ${data.coachName} wurde storniert`,
    html: bookingCancelledNoticeHtml(data),
    text: bookingCancelledNoticeText(data),
  })
}

export async function sendSubscriptionCancelledNotice(to: string, data: SubscriptionCancelledNoticeData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Dein Abonnement bei ${data.coachName} wurde beendet`,
    html: subscriptionCancelledNoticeHtml(data),
    text: subscriptionCancelledNoticeText(data),
  })
}

export async function sendSessionReviewPrompt(to: string, data: SessionReviewPromptData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Wie war deine Session mit ${data.coachName}?`,
    html: sessionReviewPromptHtml(data),
    text: sessionReviewPromptText(data),
  })
}

export async function sendRescheduleConfirmation(to: string, data: RescheduleConfirmationData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Session verschoben: neuer Termin mit ${data.coachName}`,
    html: rescheduleConfirmationHtml(data),
    text: rescheduleConfirmationText(data),
  })
}

export async function sendSessionCancellation(to: string, data: SessionCancellationData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Session storniert – ${data.scheduledDate}`,
    html: sessionCancellationHtml(data),
    text: sessionCancellationText(data),
  })
}

export async function sendVideoClassConfirmation(to: string, data: VideoClassConfirmationData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Du bist angemeldet: ${data.classTitle}`,
    html: videoClassConfirmationHtml(data),
    text: videoClassConfirmationText(data),
  })
}

export async function sendVideoClassNewParticipant(to: string, data: VideoClassNewParticipantData) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Neue Anmeldung: ${data.participantName} für „${data.classTitle}"`,
    html: videoClassNewParticipantHtml(data),
    text: videoClassNewParticipantText(data),
  })
}

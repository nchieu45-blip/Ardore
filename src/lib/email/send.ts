import { resend, FROM } from './index'
import {
  purchaseReceiptHtml, purchaseReceiptText, PurchaseReceiptData,
  newSubscriberHtml, newSubscriberText, NewSubscriberData,
  chatNotificationHtml, chatNotificationText, ChatNotificationData,
} from './templates'

export async function sendPurchaseReceipt(to: string, data: PurchaseReceiptData) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Kaufbestätigung: ${data.productTitle}`,
    html: purchaseReceiptHtml(data),
    text: purchaseReceiptText(data),
  })
}

export async function sendNewSubscriberNotification(to: string, data: NewSubscriberData) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Neuer Abonnent: ${data.subscriberName} hat dein Abo gestartet`,
    html: newSubscriberHtml(data),
    text: newSubscriberText(data),
  })
}

export async function sendChatNotification(to: string, data: ChatNotificationData) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Neue Nachricht von ${data.senderName}`,
    html: chatNotificationHtml(data),
    text: chatNotificationText(data),
  })
}

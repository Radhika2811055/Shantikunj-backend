const User = require('../models/User')
const sendMail = require('../config/mailer')
const { createBulkNotifications } = require('./notificationService')

const getTranslatorRecipients = async () => {
  return User.find({
    role: 'translator',
    status: 'approved',
    isActive: true
  }).select('_id name email language')
}

const notifyAllTranslators = async ({
  subject,
  title,
  message,
  metadata = {},
  ctaUrl,
  ctaLabel = 'Open LMS Dashboard'
}) => {
  const recipients = await getTranslatorRecipients()

  if (recipients.length === 0) {
    return {
      recipients: 0,
      notificationsCreated: 0,
      emailsSent: 0,
      emailsFailed: []
    }
  }

  const notifications = await createBulkNotifications({
    userIds: recipients.map((user) => user._id),
    type: 'task',
    title,
    message,
    metadata
  })

  const emailsFailed = []
  let emailsSent = 0

  for (const recipient of recipients) {
    const mailResult = await sendMail({
      to: recipient.email,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
          <p>Pranam <strong>${recipient.name}</strong>,</p>
          <p>${message}</p>
          ${ctaUrl ? `
            <a href="${ctaUrl}"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 12px;">
              ${ctaLabel}
            </a>
          ` : ''}
          <p style="color: #888; font-size: 12px; margin-top: 14px;">
            This is an automated message from Shantikunj LMS.
          </p>
        </div>
      `
    })

    if (mailResult?.sent) {
      emailsSent += 1
    } else {
      emailsFailed.push({
        email: recipient.email,
        reason: mailResult?.error || 'Mail dispatch failed'
      })
    }
  }

  return {
    recipients: recipients.length,
    notificationsCreated: Array.isArray(notifications) ? notifications.length : 0,
    emailsSent,
    emailsFailed
  }
}

module.exports = {
  notifyAllTranslators
}

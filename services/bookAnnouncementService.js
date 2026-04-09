const User = require('../models/User')
const sendMail = require('../config/mailer')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const asString = (value) => String(value || '').trim()

const escapeHtml = (value) => {
    const source = String(value || '')
    return source
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

const applyTokens = (template, tokens) => {
    if (!template) return ''
    return String(template).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
        return Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key] || '') : ''
    })
}

const normalizeTemplateInput = (rawTemplate) => {
    if (!rawTemplate) return {}
    if (typeof rawTemplate === 'object' && !Array.isArray(rawTemplate)) {
        return rawTemplate
    }

    if (typeof rawTemplate === 'string') {
        try {
            const parsed = JSON.parse(rawTemplate)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed
            }
        } catch (_error) {
            return {}
        }
    }

    return {}
}

const resolveMailContent = ({ recipientName, book, announcedBy, template, frontendUrl }) => {
    const safeTitle = asString(book?.title)
    const safeBookNumber = asString(book?.bookNumber)
    const safeDescription = asString(book?.description)
    const safeRecipient = asString(recipientName) || 'User'
    const safeAnnouncedBy = asString(announcedBy) || 'Admin Team'
    const safeFrontendUrl = asString(template?.ctaUrl || frontendUrl)

    const textTokens = {
        name: safeRecipient,
        bookTitle: safeTitle,
        bookNumber: safeBookNumber,
        bookDescription: safeDescription,
        announcedBy: safeAnnouncedBy,
        ctaUrl: safeFrontendUrl
    }

    const htmlTokens = {
        name: escapeHtml(safeRecipient),
        bookTitle: escapeHtml(safeTitle),
        bookNumber: escapeHtml(safeBookNumber),
        bookDescription: escapeHtml(safeDescription),
        announcedBy: escapeHtml(safeAnnouncedBy),
        ctaUrl: escapeHtml(safeFrontendUrl)
    }

    const subjectTemplate = asString(template?.subject) || asString(process.env.NEW_BOOK_MAIL_SUBJECT) || 'New Book Added - {{bookTitle}}'
    const customHtmlTemplate = asString(template?.html) || asString(process.env.NEW_BOOK_MAIL_HTML_TEMPLATE)

    if (customHtmlTemplate) {
        return {
            subject: applyTokens(subjectTemplate, textTokens),
            html: applyTokens(customHtmlTemplate, htmlTokens)
        }
    }

    const headingTemplate = asString(template?.heading) || asString(process.env.NEW_BOOK_MAIL_HEADING) || 'A New Book Has Been Added'
    const introTemplate = asString(template?.intro) || asString(process.env.NEW_BOOK_MAIL_INTRO) || 'A fresh title is now available in Shantikunj Audiobooks LMS.'
    const bodyTemplate = asString(template?.body) || asString(process.env.NEW_BOOK_MAIL_BODY) || 'Book details are shared below.'
    const footerTemplate = asString(template?.footer) || asString(process.env.NEW_BOOK_MAIL_FOOTER) || 'This is an automated message from Shantikunj LMS.'
    const ctaLabelTemplate = asString(template?.ctaLabel) || asString(process.env.NEW_BOOK_MAIL_CTA_LABEL) || 'Open LMS Dashboard'

    const heading = applyTokens(headingTemplate, htmlTokens)
    const intro = applyTokens(introTemplate, htmlTokens)
    const body = applyTokens(bodyTemplate, htmlTokens)
    const footer = applyTokens(footerTemplate, htmlTokens)
    const ctaLabel = applyTokens(ctaLabelTemplate, htmlTokens)

    return {
        subject: applyTokens(subjectTemplate, textTokens),
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="color: #1D9E75; margin-bottom: 8px;">${heading}</h2>
        <p>Pranam <strong>${htmlTokens.name}</strong>,</p>
        <p>${intro}</p>
        <p>${body}</p>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <strong>Book:</strong> ${htmlTokens.bookTitle}<br/>
          <strong>Book Number:</strong> ${htmlTokens.bookNumber}<br/>
          ${htmlTokens.bookDescription ? `<strong>Description:</strong> ${htmlTokens.bookDescription}<br/>` : ''}
          <strong>Added By:</strong> ${htmlTokens.announcedBy}
        </div>
        ${htmlTokens.ctaUrl ? `
          <a href="${htmlTokens.ctaUrl}"
             style="background: #1D9E75; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            ${ctaLabel}
          </a>
        ` : ''}
        <p style="color: #777; font-size: 12px; margin-top: 16px;">${footer}</p>
      </div>
    `
    }
}

const notifyRegisteredUsersAboutNewBook = async ({ book, template, announcedBy }) => {
    const recipients = await User.find({
        status: 'approved',
        isActive: true,
        email: { $exists: true, $ne: '' }
    }).select('name email role')

    const includeAdmins = String(process.env.NEW_BOOK_MAIL_INCLUDE_ADMINS || 'false').toLowerCase() === 'true'
    const targetRecipients = includeAdmins
        ? recipients
        : recipients.filter((recipient) => String(recipient.role || '').toLowerCase() !== 'admin')

    if (targetRecipients.length === 0) {
        return {
            recipients: 0,
            emailsAttempted: 0,
            emailsSent: 0,
            emailsFailed: []
        }
    }

    const batchSize = Math.max(1, Number(process.env.NEW_BOOK_MAIL_BATCH_SIZE) || 20)
    const batchDelayMs = Math.max(0, Number(process.env.NEW_BOOK_MAIL_BATCH_DELAY_MS) || 700)
    const normalizedTemplate = normalizeTemplateInput(template)

    const summary = {
        recipients: targetRecipients.length,
        emailsAttempted: 0,
        emailsSent: 0,
        emailsFailed: []
    }

    for (let offset = 0; offset < targetRecipients.length; offset += batchSize) {
        const batch = targetRecipients.slice(offset, offset + batchSize)
        const sendResults = await Promise.all(batch.map(async (recipient) => {
            const mailPayload = resolveMailContent({
                recipientName: recipient.name,
                book,
                announcedBy,
                template: normalizedTemplate,
                frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
            })

            summary.emailsAttempted += 1
            const mailResult = await sendMail({
                to: recipient.email,
                subject: mailPayload.subject,
                html: mailPayload.html
            })

            if (mailResult?.sent) {
                summary.emailsSent += 1
                return
            }

            summary.emailsFailed.push({
                email: recipient.email,
                reason: mailResult?.error || 'Mail dispatch failed'
            })
        }))

        await Promise.allSettled(sendResults)

        if (offset + batchSize < targetRecipients.length && batchDelayMs > 0) {
            await wait(batchDelayMs)
        }
    }

    return summary
}

module.exports = {
    notifyRegisteredUsersAboutNewBook
}

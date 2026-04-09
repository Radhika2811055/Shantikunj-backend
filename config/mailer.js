const nodemailer = require('nodemailer')

let transporter = null
let transporterUser = ''
let transporterConfigKey = ''

const getBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

const getTransportOptions = (emailUser, emailPass) => {
  const smtpHost = process.env.SMTP_HOST
  const smtpPort = Number(process.env.SMTP_PORT) || 587

  if (smtpHost) {
    return {
      key: `smtp:${smtpHost}:${smtpPort}:${emailUser}`,
      options: {
        host: smtpHost,
        port: smtpPort,
        secure: getBoolean(process.env.SMTP_SECURE, smtpPort === 465),
        auth: {
          user: emailUser,
          pass: emailPass
        }
      }
    }
  }

  const emailService = process.env.EMAIL_SERVICE || 'gmail'
  return {
    key: `service:${emailService}:${emailUser}`,
    options: {
      service: emailService,
      auth: {
        user: emailUser,
        pass: emailPass
      }
    }
  }
}

const getTransporter = () => {
  const emailUser = process.env.EMAIL_USER
  const emailPass = process.env.EMAIL_PASS

  if (!emailUser || !emailPass) {
    return { transporter: null, emailUser: null, missingConfig: true }
  }

  const transportConfig = getTransportOptions(emailUser, emailPass)

  // Recreate transporter if sender account or transport config changes at runtime.
  if (!transporter || transporterUser !== emailUser || transporterConfigKey !== transportConfig.key) {
    transporter = nodemailer.createTransport(transportConfig.options)
    transporterUser = emailUser
    transporterConfigKey = transportConfig.key
  }

  return { transporter, emailUser, missingConfig: false }
}

const sendMail = async ({ to, subject, html }) => {
  const { transporter: smtp, emailUser, missingConfig } = getTransporter()

  if (missingConfig || !smtp || !emailUser) {
    console.warn('Email skipped: EMAIL_USER/EMAIL_PASS missing')
    return {
      sent: false,
      skipped: true,
      error: 'Email skipped: EMAIL_USER/EMAIL_PASS missing'
    }
  }

  try {
    const fromName = process.env.EMAIL_FROM_NAME || 'Shantikunj LMS'

    await smtp.sendMail({
      from: `"${fromName}" <${emailUser}>`,
      to,
      subject,
      html
    })
    console.log(`Email sent to ${to}`)
    return { sent: true }
  } catch (error) {
    const message = error?.message || 'Unknown email error'
    const details = {
      code: error?.code || null,
      responseCode: error?.responseCode || null,
      command: error?.command || null,
      response: error?.response || null
    }

    console.error('Email error:', message, details)
    return {
      sent: false,
      error: message,
      details
    } // do not throw
  }
}

module.exports = sendMail
const nodemailer = require('nodemailer')

let transporter = null
let transporterUser = ''

const getTransporter = () => {
  const emailUser = process.env.EMAIL_USER
  const emailPass = process.env.EMAIL_PASS

  if (!emailUser || !emailPass) {
    return { transporter: null, emailUser: null, missingConfig: true }
  }

  // Recreate transporter if sender account changes at runtime.
  if (!transporter || transporterUser !== emailUser) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    })
    transporterUser = emailUser
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
    await smtp.sendMail({
      from: `"Shantikunj LMS" <${emailUser}>`,
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
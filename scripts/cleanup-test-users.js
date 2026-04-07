const mongoose = require('mongoose')
const dotenv = require('dotenv')
const User = require('../models/User')

dotenv.config()

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected')

    const fakeDomains = [
      'test.com',
      'example.com',
      'mailinator.com',
      'yopmail.com',
      'guerrillamail.com',
      '10minutemail.com',
      'temp-mail.org',
      'fakeinbox.com'
    ]

    const escaped = fakeDomains.map((d) => d.replace('.', '\\.'))
    const domainRegex = `@(${escaped.join('|')})$`

    const result = await User.deleteMany({
      email: { $regex: domainRegex, $options: 'i' }
    })

    console.log(`Deleted fake/disposable-domain users: ${result.deletedCount}`)
    process.exit(0)
  } catch (error) {
    console.error('Cleanup failed:', error.message)
    process.exit(1)
  }
}

run()

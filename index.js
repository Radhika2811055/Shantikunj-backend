const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const dotenv = require('dotenv')
const path = require('path')
const cron = require('node-cron')
const { MongoMemoryServer } = require('mongodb-memory-server')
const sendFollowUps = require('./jobs/followUpJob')
const session = require('express-session')
const { protect, authorise } = require('./middleware/authMiddleware')
const { uploadAudioFile: uploadAudioFileMiddleware } = require('./middleware/uploadMiddleware')
const { uploadAudioFile } = require('./controllers/bookController')

dotenv.config({ path: path.join(__dirname, '.env') })

const passport = require('./config/passport')
const PORT = Number(process.env.PORT) || 5000

const app = express()
app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false
}))
app.use(passport.initialize())
app.use(passport.session())


// Middleware
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Routes

// for normal user login and registration
const authRoutes = require('./routes/authRoutes')
app.use('/api/auth', authRoutes)

// for admin actions like approving/rejecting users
const adminRoutes = require('./routes/adminRoutes')
app.use('/api/admin', adminRoutes)

const bookRoutes = require('./routes/bookRoutes')
app.use('/api/books', bookRoutes)

// Fallback upload route to ensure recorder audio uploads are always reachable.
app.post('/api/books/upload-audio-file', protect, authorise('recorder'), uploadAudioFileMiddleware.any(), uploadAudioFile)

const claimRoutes = require('./routes/claimRoutes')
app.use('/api/claims', claimRoutes)

const supportRoutes = require('./routes/supportRoutes')
app.use('/api/support', supportRoutes)

const feedbackRoutes = require('./routes/feedbackRoutes')
app.use('/api/feedback', feedbackRoutes)

const notificationRoutes = require('./routes/notificationRoutes')
app.use('/api/notifications', notificationRoutes)

const auditRoutes = require('./routes/auditRoutes')
app.use('/api/audit', auditRoutes)

// Test route
app.get('/', (req, res) => {
  res.send('Shantikunj server is running!')
})

// Scheduled job — runs every day at 9:00 AM
cron.schedule('0 9 * * *', () => {
  console.log('Running scheduled follow-up job...')
  sendFollowUps()
})


const startServer = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not set')
    }

    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected!')
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.log('Connection error:', err)
      process.exit(1)
    }

    console.warn('Primary MongoDB connection failed. Falling back to in-memory MongoDB for development.')
    const memoryServer = await MongoMemoryServer.create()
    const memoryUri = memoryServer.getUri()
    await mongoose.connect(memoryUri)
    console.log('In-memory MongoDB connected!')
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
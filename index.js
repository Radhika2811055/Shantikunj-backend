const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const dotenv = require('dotenv')
const path = require('path')
const cron = require('node-cron')
const sendFollowUps = require('./jobs/followUpJob')
const session = require('express-session')
const { protect, authorise } = require('./middleware/authMiddleware')
const { uploadAudioFile: uploadAudioFileMiddleware } = require('./middleware/uploadMiddleware')
const { uploadAudioFile } = require('./controllers/bookController')

dotenv.config({ path: path.join(__dirname, '.env') })

const passport = require('./config/passport')

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


// Connect to MongoDB and start server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected!')
    app.listen(5000, () => {
      console.log('Server running on port 5000')
    })
  })
  .catch((err) => console.log('Connection error:', err))
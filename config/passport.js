const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const User = require('../models/User')

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value
        const name = profile.displayName

        // Check if user already exists
        let user = await User.findOne({ email })

        if (user) {
          // User exists — check if they registered manually before
          if (user.authMethod === 'local') {
            // Link Google to existing account
            user.googleId = profile.id
            user.authMethod = 'google'
            user.emailVerified = true
            await user.save()
          }
          return done(null, user)
        }

        // New user — create account with pending status
        user = await User.create({
          name,
          email,
          googleId: profile.id,
          authMethod: 'google',
          password: 'google_oauth_no_password',
          role: 'pending',
          status: 'pending',
          isActive: false,
          emailVerified: true
        })

        return done(null, user)

      } catch (error) {
        return done(error, null)
      }
    }
  ))
} else {
  console.warn('Google OAuth is disabled: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_CALLBACK_URL')
}

passport.serializeUser((user, done) => {
  done(null, user._id)
})

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id)
    done(null, user)
  } catch (error) {
    done(error, null)
  }
})

module.exports = passport
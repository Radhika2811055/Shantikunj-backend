const jwt = require('jsonwebtoken')
const User = require('../models/User')

//Verify token 
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token, access denied' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // It finds the user in the database using the ID inside the token but hides the password (-password) for safety
    req.user = await User.findById(decoded.userId).select('-password')

    if (!req.user) {
      return res.status(401).json({ message: 'User not found' })
    }

    // If everything is good, it calls next() to move on to the next middleware or route handler.
    // let the user move through the next function
    next()

  } catch (error) {
    res.status(401).json({ message: 'Token invalid or expired' })
  }
}

//Check role
const authorise = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Access denied. Required role: ${roles.join(' or ')}` 
      })
    }
    next()
  }
}

module.exports = { protect, authorise }
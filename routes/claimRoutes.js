const express = require('express')
const router = express.Router()
const { protect, authorise } = require('../middleware/authMiddleware')
const {
  sendInterestEmail,
  claimBook,
  getAvailableBooks,
  getMyClaim,
  getMyClaimHistory
} = require('../controllers/claimController')

router.use(protect)

// Admin sends interest email
router.post('/books/:bookId/send-interest', authorise('admin'), sendInterestEmail)

// User claims a book
router.post('/books/:bookId/claim', authorise('translator', 'checker', 'audio_checker', 'recorder'), claimBook)

// User sees available books for their language
router.get('/available', getAvailableBooks)

// User sees their active claim
router.get('/my-claim', authorise('translator', 'checker', 'audio_checker', 'recorder'), getMyClaim)
router.get('/my-history', authorise('translator', 'checker', 'audio_checker', 'recorder'), getMyClaimHistory)

module.exports = router
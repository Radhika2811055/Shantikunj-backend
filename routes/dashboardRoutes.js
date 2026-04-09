const express = require('express')
const router = express.Router()
const { protect, authorise } = require('../middleware/authMiddleware')
const {
    getDashboardSummary,
    getDashboardReviewQueue
} = require('../controllers/dashboardController')

router.use(protect)
router.use(authorise('admin', 'spoc'))

router.get('/summary', getDashboardSummary)
router.get('/review-queue', getDashboardReviewQueue)

module.exports = router

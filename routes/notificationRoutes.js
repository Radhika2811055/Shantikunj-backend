const express = require('express')
const router = express.Router()
const { protect } = require('../middleware/authMiddleware')
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  cleanupOldNotifications
} = require('../controllers/notificationController')

router.use(protect)

router.get('/my', getMyNotifications)
router.put('/:notificationId/read', markNotificationRead)
router.put('/read-all', markAllNotificationsRead)
router.delete('/:notificationId', deleteNotification)
router.delete('/cleanup/old', cleanupOldNotifications)

module.exports = router

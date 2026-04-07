const Notification = require('../models/Notification')

const AUTO_DELETE_READ_DAYS = 90

const getMyNotifications = async (req, res) => {
  try {
    const autoCutoff = new Date(Date.now() - AUTO_DELETE_READ_DAYS * 24 * 60 * 60 * 1000)

    await Notification.deleteMany({
      user: req.user._id,
      isRead: true,
      createdAt: { $lt: autoCutoff }
    })

    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)

    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false
    })

    return res.status(200).json({ notifications, unreadCount })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user._id },
      { isRead: true },
      { new: true }
    )

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' })
    }

    return res.status(200).json({ message: 'Notification marked as read', notification })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    )

    return res.status(200).json({ message: 'All notifications marked as read' })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params

    const deleted = await Notification.findOneAndDelete({
      _id: notificationId,
      user: req.user._id
    })

    if (!deleted) {
      return res.status(404).json({ message: 'Notification not found' })
    }

    return res.status(200).json({ message: 'Notification deleted successfully' })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const cleanupOldNotifications = async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30))
    const readOnly = String(req.query.readOnly || 'true').toLowerCase() !== 'false'
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const filter = {
      user: req.user._id,
      createdAt: { $lt: cutoff }
    }

    if (readOnly) {
      filter.isRead = true
    }

    const result = await Notification.deleteMany(filter)

    return res.status(200).json({
      message: 'Old notifications cleaned up',
      deletedCount: result.deletedCount || 0,
      days,
      readOnly
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  cleanupOldNotifications
}

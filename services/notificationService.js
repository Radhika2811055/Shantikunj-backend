const Notification = require('../models/Notification')

const createNotification = async ({ userId, type = 'system', title, message, metadata = {} }) => {
  if (!userId || !title || !message) return null

  try {
    return await Notification.create({
      user: userId,
      type,
      title,
      message,
      metadata
    })
  } catch (_error) {
    return null
  }
}

const createBulkNotifications = async ({ userIds, type = 'system', title, message, metadata = {} }) => {
  if (!Array.isArray(userIds) || userIds.length === 0 || !title || !message) return []

  const uniqueUserIds = [...new Set(userIds.map(String))]
  const docs = uniqueUserIds.map((userId) => ({
    user: userId,
    type,
    title,
    message,
    metadata
  }))

  try {
    return await Notification.insertMany(docs, { ordered: false })
  } catch (_error) {
    return []
  }
}

module.exports = {
  createNotification,
  createBulkNotifications
}

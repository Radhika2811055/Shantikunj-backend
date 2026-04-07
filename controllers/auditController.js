const AuditLog = require('../models/AuditLog')

const getAuditLogs = async (req, res) => {
  try {
    const { bookId, language, action, limit = 100 } = req.query
    const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 100))

    const filter = {}
    if (bookId) filter.book = bookId
    if (language) filter.language = language
    if (action) filter.action = action

    if (req.user.role === 'spoc') {
      filter.language = req.user.language
    }

    const logs = await AuditLog.find(filter)
      .populate('actor', 'name email role language')
      .sort({ createdAt: -1 })
      .limit(parsedLimit)

    return res.status(200).json(logs)
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = { getAuditLogs }

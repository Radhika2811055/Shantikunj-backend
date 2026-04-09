const Book = require('../models/Book')
const Claim = require('../models/Claim')
const User = require('../models/User')
const SupportRequest = require('../models/SupportRequest')

const getDashboardSummary = async (req, res) => {
  try {
    const isSpoc = req.user.role === 'spoc'
    const languageFilter = isSpoc ? req.user.language : null

    const userFilter = {
      status: 'approved',
      isActive: true
    }

    if (languageFilter) {
      userFilter.language = languageFilter
    }

    const [
      totalBooks,
      activeClaims,
      openSupport,
      pendingUsers,
      totalTranslators,
      versionStats
    ] = await Promise.all([
      Book.countDocuments({}),
      Claim.countDocuments({ status: 'active' }),
      SupportRequest.countDocuments({ status: { $in: ['open', 'in_progress'] }, ...(languageFilter ? { language: languageFilter } : {}) }),
      User.countDocuments({ status: 'pending' }),
      User.countDocuments({ ...userFilter, role: 'translator' }),
      Book.aggregate([
        { $unwind: '$languageVersions' },
        ...(languageFilter ? [{ $match: { 'languageVersions.language': languageFilter } }] : []),
        {
          $group: {
            _id: null,
            totalVersions: { $sum: 1 },
            openTranslation: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$languageVersions.currentStage', 'translation'] },
                      { $eq: ['$languageVersions.isLocked', false] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            waitingTextVetter: {
              $sum: {
                $cond: [{ $eq: ['$languageVersions.currentStage', 'checking'] }, 1, 0]
              }
            },
            waitingAudioVetter: {
              $sum: {
                $cond: [{ $eq: ['$languageVersions.currentStage', 'audio_checking'] }, 1, 0]
              }
            },
            openForReview: {
              $sum: {
                $cond: [{ $eq: ['$languageVersions.openForTranslatorReview', true] }, 1, 0]
              }
            },
            published: {
              $sum: {
                $cond: [{ $eq: ['$languageVersions.audioStatus', 'published'] }, 1, 0]
              }
            }
          }
        }
      ])
    ])

    return res.status(200).json({
      totalBooks,
      activeClaims,
      openSupport,
      pendingUsers,
      totalTranslators,
      versions: versionStats[0] || {
        totalVersions: 0,
        openTranslation: 0,
        waitingTextVetter: 0,
        waitingAudioVetter: 0,
        openForReview: 0,
        published: 0
      }
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getDashboardReviewQueue = async (req, res) => {
  try {
    const isSpoc = req.user.role === 'spoc'
    const language = isSpoc ? req.user.language : String(req.query.language || '').trim() || null
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25))

    const books = await Book.find({})
      .select('title bookNumber languageVersions')
      .sort({ updatedAt: -1 })

    const queue = []
    for (const book of books) {
      for (const version of book.languageVersions || []) {
        if (language && version.language !== language) continue
        if (!version.openForTranslatorReview) continue

        queue.push({
          bookId: book._id,
          versionId: version._id,
          title: book.title,
          bookNumber: book.bookNumber,
          language: version.language,
          audioStatus: version.audioStatus,
          feedbackDeadline: version.feedbackDeadline || null,
          openedAt: version.translatorReviewOpenedAt || null
        })
      }
    }

    return res.status(200).json({
      items: queue.slice(0, limit),
      count: queue.length
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  getDashboardSummary,
  getDashboardReviewQueue
}

const Book = require('../models/Book')
const Feedback = require('../models/Feedback')
const { logAudit } = require('../services/auditService')

const canSubmitFeedbackRole = (role) => {
  return ['regional_team', 'translator', 'checker', 'audio_checker', 'recorder', 'spoc'].includes(role)
}

const isSameUserId = (value, userId) => {
  if (!value || !userId) return false
  return value.toString() === userId.toString()
}

const canViewFeedbackForVersion = (user, version) => {
  if (!user || !version) return false

  if (user.role === 'admin') return true
  if (user.role === 'spoc') return user.language === version.language
  if (user.role === 'translator') return isSameUserId(version.assignedTranslator, user._id)

  if (user.role === 'checker') {
    return isSameUserId(version.assignedChecker, user._id)
  }

  if (user.role === 'audio_checker') return isSameUserId(version.assignedAudioChecker, user._id)

  if (user.role === 'recorder') return isSameUserId(version.assignedRecorder, user._id)
  if (user.role === 'regional_team') return user.language === version.language

  return false
}

const submitFeedback = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { rating, text } = req.body

    if (!canSubmitFeedbackRole(req.user.role)) {
      return res.status(403).json({ message: 'Your role cannot submit feedback' })
    }

    const parsedRating = Number(rating)
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' })
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Feedback text is required' })
    }

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.language !== version.language) {
      return res.status(403).json({ message: 'You can only submit feedback for your own language' })
    }

    if (version.audioStatus !== 'audio_approved') {
      return res.status(400).json({ message: 'Feedback is allowed only after SPOC audio approval' })
    }

    if (!version.feedbackDeadline) {
      return res.status(400).json({ message: 'Feedback window is not opened yet' })
    }

    if (new Date() > new Date(version.feedbackDeadline)) {
      return res.status(400).json({ message: 'Feedback window is closed for this version' })
    }

    const feedback = await Feedback.findOneAndUpdate(
      {
        book: bookId,
        versionId,
        reviewer: req.user._id
      },
      {
        language: version.language,
        rating: parsedRating,
        text: text.trim()
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    )

    await logAudit({
      req,
      action: 'feedback_submitted',
      entityType: 'feedback',
      entityId: feedback._id,
      book: book._id,
      versionId,
      language: version.language,
      metadata: { rating: parsedRating }
    })

    return res.status(200).json({
      message: 'Feedback submitted successfully',
      feedback
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getFeedbackList = async (req, res) => {
  try {
    const { bookId, versionId } = req.params

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (!canViewFeedbackForVersion(req.user, version)) {
      return res.status(403).json({ message: 'You are not allowed to view feedback for this version' })
    }

    const feedbackList = await Feedback.find({ book: bookId, versionId })
      .populate('reviewer', 'name email role language')
      .sort({ createdAt: -1 })

    return res.status(200).json(feedbackList)
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getFeedbackSummary = async (req, res) => {
  try {
    const { bookId, versionId } = req.params

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (!canViewFeedbackForVersion(req.user, version)) {
      return res.status(403).json({ message: 'You are not allowed to view feedback summary for this version' })
    }

    const summary = await Feedback.aggregate([
      {
        $match: {
          book: Book.db.base.Types.ObjectId.createFromHexString(bookId),
          versionId: Book.db.base.Types.ObjectId.createFromHexString(versionId)
        }
      },
      {
        $group: {
          _id: null,
          totalFeedback: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          minRating: { $min: '$rating' },
          maxRating: { $max: '$rating' }
        }
      }
    ])

    return res.status(200).json(summary[0] || {
      totalFeedback: 0,
      avgRating: null,
      minRating: null,
      maxRating: null
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  submitFeedback,
  getFeedbackList,
  getFeedbackSummary
}

const mongoose = require('mongoose')

const feedbackSchema = new mongoose.Schema({
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  versionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  language: {
    type: String,
    required: true
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  text: {
    type: String,
    required: true,
    trim: true
  }
}, { timestamps: true })

feedbackSchema.index({ book: 1, versionId: 1, reviewer: 1 }, { unique: true })

module.exports = mongoose.model('Feedback', feedbackSchema)

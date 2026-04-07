const mongoose = require('mongoose')

const claimSchema = new mongoose.Schema({
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  language: {
    type: String,
    required: true
  },
  claimedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // What stage is this claim for
  claimType: {
    type: String,
    enum: ['translation', 'checking', 'audio', 'audio_check'],
    required: true
  },
  daysCommitted: {
    type: Number,
    required: true
  },
  claimedAt: {
    type: Date,
    default: Date.now
  },
  deadline: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'submitted', 'completed', 'expired', 'released'],
    default: 'active'
  },
  lastFollowUpSent: {
    type: Date,
    default: null
  },
  followUpCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true })

module.exports = mongoose.model('Claim', claimSchema)
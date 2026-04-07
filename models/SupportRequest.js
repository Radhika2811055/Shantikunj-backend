const mongoose = require('mongoose')

const supportRequestSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  language: {
    type: String,
    default: null
  },
  requestType: {
    type: String,
    enum: ['support', 'callback'],
    default: 'support'
  },
  category: {
    type: String,
    enum: ['technical', 'workflow', 'account', 'audio_quality', 'other'],
    default: 'other'
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    default: null
  },
  preferredCallTime: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    default: 'open'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resolutionNote: {
    type: String,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true })

module.exports = mongoose.model('SupportRequest', supportRequestSchema)

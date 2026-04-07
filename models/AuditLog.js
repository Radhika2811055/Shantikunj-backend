const mongoose = require('mongoose')

const auditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  actorRole: {
    type: String,
    default: null
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  entityType: {
    type: String,
    enum: ['book_version', 'claim', 'feedback', 'support_request', 'user', 'system'],
    default: 'system'
  },
  entityId: {
    type: String,
    default: null,
    index: true
  },
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    default: null,
    index: true
  },
  versionId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  language: {
    type: String,
    default: null,
    index: true
  },
  fromState: {
    type: String,
    default: null
  },
  toState: {
    type: String,
    default: null
  },
  note: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true })

module.exports = mongoose.model('AuditLog', auditLogSchema)

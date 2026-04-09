const mongoose = require('mongoose')

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  googleId: {
  type: String,
  default: null
  },
  authMethod: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  role: {
    type: String,
    enum: ['admin', 'spoc', 'translator', 'checker', 'text_vetter', 'audio_checker', 'audio_vetter', 'recorder', 'regional_team', 'pending'],
    default: 'pending'   // no role until admin assigns
  },
  requestedRole: {
    type: String,
    enum: ['spoc', 'translator', 'checker', 'text_vetter', 'audio_checker', 'audio_vetter', 'recorder', 'regional_team', null],
    default: null
  },
  language: {
    type: String,
    default: null
  },
  requestedLanguage: {
    type: String,
    default: null
  },
  emailVerified: {
    type: Boolean,
    default: true
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpiry: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'   // all new users start as pending
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',         // which admin approved them
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: false       // false until admin approves
  },
  resetToken: {
  type: String,
  default: null
  },
  resetTokenExpiry: {
    type: Date,
    default: null
  }
}, { timestamps: true })

module.exports = mongoose.model('User', userSchema)
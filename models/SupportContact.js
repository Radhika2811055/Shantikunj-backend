const mongoose = require('mongoose')

const supportContactSchema = new mongoose.Schema({
  name: {
    type: String,
    default: null,
    trim: true
  },
  email: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    default: null,
    trim: true
  },
  whatsapp: {
    type: String,
    default: null,
    trim: true
  },
  workingHours: {
    type: String,
    default: null,
    trim: true
  },
  note: {
    type: String,
    default: null,
    trim: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true })

module.exports = mongoose.model('SupportContact', supportContactSchema)

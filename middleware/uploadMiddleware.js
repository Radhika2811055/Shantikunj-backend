const fs = require('fs')
const path = require('path')
const multer = require('multer')

const translationUploadsDir = path.join(__dirname, '..', 'uploads', 'translations')
const audioUploadsDir = path.join(__dirname, '..', 'uploads', 'audio')

fs.mkdirSync(translationUploadsDir, { recursive: true })
fs.mkdirSync(audioUploadsDir, { recursive: true })

const createStorage = (targetDir) => multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, targetDir)
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
    cb(null, `${Date.now()}-${safeName}`)
  }
})

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
])

const allowedAudioMimeTypes = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mpeg',
  'audio/mpeg3',
  'audio/mp4',
  'video/mp4'
])

const uploadTranslationDoc = multer({
  storage: createStorage(translationUploadsDir),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const hasAllowedExtension = /\.(pdf|doc|docx|txt)$/i.test(file.originalname || '')
    if (allowedMimeTypes.has(file.mimetype) || hasAllowedExtension) {
      cb(null, true)
      return
    }

    cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed'))
  }
})

const uploadAudioFile = multer({
  storage: createStorage(audioUploadsDir),
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const hasAllowedExtension = /\.(mp3|mp4)$/i.test(file.originalname || '')
    if (allowedAudioMimeTypes.has(file.mimetype) || hasAllowedExtension) {
      cb(null, true)
      return
    }

    cb(new Error('Only MP3 and MP4 files are allowed'))
  }
})

module.exports = {
  uploadTranslationDoc,
  uploadAudioFile
}

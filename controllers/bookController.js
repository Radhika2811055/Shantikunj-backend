const Book = require('../models/Book')
const User = require('../models/User')
const Claim = require('../models/Claim')
const sendMail = require('../config/mailer')
const { createNotification, createBulkNotifications } = require('../services/notificationService')
const { logAudit } = require('../services/auditService')
const { isCloudinaryConfigured, uploadFileToCloudinary, removeLocalFile } = require('../services/cloudinaryService')

const REASSIGNMENT_THRESHOLD = 3
const DEFAULT_TRANSLATION_INVITE_LANGUAGES = ['English']
const BOOK_LANGUAGES = [
  'Assamese',
  'Bengali',
  'Bhojpuri',
  'Chattisgarhiya',
  'Chinese',
  'Dutch',
  'English',
  'French',
  'Garhwali',
  'German',
  'Gujarati',
  'Hindi',
  'Japanese',
  'Kannada',
  'Kumaoni',
  'Malayalam',
  'Marathi',
  'Nepali',
  'Oriya',
  'Punjabi',
  'Russian',
  'Sindhi',
  'South Korean',
  'Spanish',
  'Tamil',
  'Telugu',
  'Urdu',
  'Vietnamese',
  'Arabic',
  'Italian',
  'Portuguese'
]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getInitialInviteLanguageSet = () => {
  const raw = String(process.env.TRANSLATION_INVITE_LANGUAGES || '').trim()
  const values = (raw ? raw.split(',') : DEFAULT_TRANSLATION_INVITE_LANGUAGES)
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  const normalized = new Set(values.map((item) => item.toLowerCase()))
  const allowAll = normalized.has('all')

  return {
    allowAll,
    normalized
  }
}

const sendMailWithRetry = async (mailPayload, maxAttempts = 3) => {
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await sendMail(mailPayload)
      if (result?.sent) {
        return { ok: true, attempts: attempt }
      }

      const fallbackMessage = result?.skipped
        ? 'Email skipped: EMAIL_USER/EMAIL_PASS missing'
        : 'Mail dispatch failed'
      lastError = new Error(result?.error || fallbackMessage)
      if (result?.details) {
        lastError.details = result.details
      }

      if (result?.skipped) {
        return { ok: false, attempts: attempt, error: lastError }
      }
    } catch (error) {
      lastError = error
    }

    if (attempt < maxAttempts) {
      await wait(900 * attempt)
    }
  }

  return { ok: false, attempts: maxAttempts, error: lastError }
}

const sendTranslationClaimInvites = async (book) => {
  const inviteLanguageConfig = getInitialInviteLanguageSet()

  const inviteSummary = {
    languagesOpenedForClaim: 0,
    languagesWithRecipients: 0,
    languagesInvited: [],
    languagesWithoutRecipients: [],
    languagesSkippedByConfig: [],
    totalEmailsAttempted: 0,
    totalEmailsSent: 0,
    totalEmailsFailed: 0,
    failedEmails: []
  }

  for (const version of book.languageVersions || []) {
    const versionLanguage = String(version.language || '').trim()
    const isConfiguredLanguage = inviteLanguageConfig.allowAll || inviteLanguageConfig.normalized.has(versionLanguage.toLowerCase())

    if (!isConfiguredLanguage) {
      version.interestEmailSent = false
      version.interestEmailSentAt = null
      inviteSummary.languagesSkippedByConfig.push(versionLanguage)
      continue
    }

    const translators = await User.find({
      language: version.language,
      role: 'translator',
      status: 'approved',
      isActive: true
    }).select('name email')

    if (translators.length === 0) {
      version.interestEmailSent = false
      version.interestEmailSentAt = null
      inviteSummary.languagesWithoutRecipients.push(version.language)
      continue
    }

    inviteSummary.languagesOpenedForClaim += 1
    // Keep task claimable even if mail dispatch is skipped/failed.
    version.interestEmailSent = true
    version.interestEmailSentAt = new Date()

    inviteSummary.languagesWithRecipients += 1

    await createBulkNotifications({
      userIds: translators.map((member) => member._id),
      type: 'task',
      title: 'New translation task available',
      message: `${book.title} (${version.language}) is open for claim.`,
      metadata: {
        bookId: book._id,
        versionId: version._id,
        language: version.language,
        stage: 'translation'
      }
    })

    inviteSummary.totalEmailsAttempted += translators.length

    let sentCount = 0
    for (const member of translators) {
      const sendResult = await sendMailWithRetry({
        to: member.email,
        subject: `New Translation Task - ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${member.name}</strong>,</p>
            <p>A new book has been added and is now open for translation claim.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Book Number:</strong> ${book.bookNumber}<br/>
              <strong>Language:</strong> ${version.language}<br/>
              <strong>Task Stage:</strong> Translation
            </div>
            <p>Login to LMS and claim this task from Work Queue. The first eligible claimant gets assigned.</p>
            <a href="http://localhost:5173"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Claim
            </a>
            <p style="color: #888; font-size: 12px; margin-top: 14px;">
              This is an automated message from Shantikunj LMS.
            </p>
          </div>
        `
      })

      if (sendResult.ok) {
        sentCount += 1
      } else {
        inviteSummary.failedEmails.push({
          language: version.language,
          email: member.email,
          attempts: sendResult.attempts,
          reason: sendResult.error?.message || 'Unknown mail error'
        })
      }

      // Tiny pacing helps avoid provider burst throttling on sequential invite sends.
      await wait(180)
    }

    const failedCount = translators.length - sentCount

    inviteSummary.totalEmailsSent += sentCount
    inviteSummary.totalEmailsFailed += failedCount

    if (sentCount > 0) {
      inviteSummary.languagesInvited.push(version.language)
    }
  }

  await book.save()
  return inviteSummary
}

const isValidHttpUrl = (value) => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch (_error) {
    return false
  }
}

const isGoogleDriveLink = (value) => value.includes('drive.google.com')
const isCloudinaryUrl = (value) => String(value || '').includes('res.cloudinary.com')
const isDocumentLink = (value) => /\.(pdf|doc|docx|txt)(\?|$)/i.test(value) || isGoogleDriveLink(value)
const isAudioLink = (value) => /\.(mp3|mp4)(\?|$)/i.test(value) || isGoogleDriveLink(value)

const parseCloudinaryMetaFromUrl = (fileUrl) => {
  try {
    const parsed = new URL(fileUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const uploadIndex = parts.indexOf('upload')

    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) {
      return { publicId: null, format: null }
    }

    const afterUpload = parts.slice(uploadIndex + 1)
    const withoutVersion = /^v\d+$/.test(afterUpload[0]) ? afterUpload.slice(1) : afterUpload
    const pathWithExt = withoutVersion.join('/')
    if (!pathWithExt) {
      return { publicId: null, format: null }
    }

    const dotIndex = pathWithExt.lastIndexOf('.')
    if (dotIndex === -1) {
      return { publicId: pathWithExt, format: null }
    }

    return {
      publicId: pathWithExt.slice(0, dotIndex),
      format: pathWithExt.slice(dotIndex + 1) || null
    }
  } catch (_error) {
    return { publicId: null, format: null }
  }
}

const normalizePayloadFiles = (payload) => {
  if (!Array.isArray(payload)) return []

  return payload
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      fileUrl: typeof item.fileUrl === 'string' ? item.fileUrl.trim() : '',
      provider: typeof item.provider === 'string' ? item.provider.trim() : null,
      publicId: typeof item.publicId === 'string' ? item.publicId.trim() : null,
      resourceType: typeof item.resourceType === 'string' ? item.resourceType.trim() : null,
      format: typeof item.format === 'string' ? item.format.trim() : null,
      bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null,
      originalFilename: typeof item.originalFilename === 'string'
        ? item.originalFilename.trim()
        : (typeof item.filename === 'string' ? item.filename.trim() : null),
      uploadedAt: item.uploadedAt ? new Date(item.uploadedAt) : new Date()
    }))
    .filter((item) => Boolean(item.fileUrl))
}

const buildFileMetadata = ({
  metaSources,
  validUrls,
  linkValidator
}) => {
  const sourceMeta = metaSources.flatMap((source) => normalizePayloadFiles(source))

  const filteredSourceMeta = sourceMeta.filter((item) => {
    return isValidHttpUrl(item.fileUrl) && linkValidator(item.fileUrl)
  })

  const byUrl = new Map()

  for (const item of filteredSourceMeta) {
    if (!byUrl.has(item.fileUrl)) {
      byUrl.set(item.fileUrl, {
        provider: item.provider || (isCloudinaryUrl(item.fileUrl) ? 'cloudinary' : 'external'),
        publicId: item.publicId || null,
        fileUrl: item.fileUrl,
        resourceType: item.resourceType || null,
        format: item.format || null,
        bytes: item.bytes,
        originalFilename: item.originalFilename || null,
        uploadedAt: item.uploadedAt instanceof Date && !Number.isNaN(item.uploadedAt.getTime())
          ? item.uploadedAt
          : new Date()
      })
    }
  }

  for (const url of validUrls) {
    if (!byUrl.has(url)) {
      const inferredCloudinaryMeta = isCloudinaryUrl(url)
        ? parseCloudinaryMetaFromUrl(url)
        : { publicId: null, format: null }

      byUrl.set(url, {
        provider: isCloudinaryUrl(url) ? 'cloudinary' : 'external',
        publicId: inferredCloudinaryMeta.publicId,
        fileUrl: url,
        resourceType: null,
        format: inferredCloudinaryMeta.format,
        bytes: null,
        originalFilename: null,
        uploadedAt: new Date()
      })
    }
  }

  return [...byUrl.values()]
}

const normalizeAudioUrls = ({ audioUrl, audioUrls, audioFiles }) => {
  const fromArray = Array.isArray(audioUrls) ? audioUrls : []
  const fromSingle = audioUrl ? [audioUrl] : []
  const fromFileObjects = normalizePayloadFiles(audioFiles).map((item) => item.fileUrl)

  const merged = [...fromArray, ...fromSingle, ...fromFileObjects]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return [...new Set(merged)]
}

const normalizeDocumentUrls = ({ textFileUrl, textFileUrls, textFiles }) => {
  const fromArray = Array.isArray(textFileUrls) ? textFileUrls : []
  const fromSingle = textFileUrl ? [textFileUrl] : []
  const fromFileObjects = normalizePayloadFiles(textFiles).map((item) => item.fileUrl)

  const merged = [...fromArray, ...fromSingle, ...fromFileObjects]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  const unique = [...new Set(merged)]
  return unique.filter((item) => isValidHttpUrl(item) && isDocumentLink(item))
}

const normalizeUploadedTranslationFiles = ({ files, file }) => {
  const fromArray = Array.isArray(files) ? files : []
  const fromFields = files && !Array.isArray(files) && typeof files === 'object'
    ? [
      ...(Array.isArray(files.documents) ? files.documents : []),
      ...(Array.isArray(files.document) ? files.document : [])
    ]
    : []
  const fromSingle = file ? [file] : []

  return [...fromArray, ...fromFields, ...fromSingle]
}

const isSameUser = (assignedUserId, currentUserId) => {
  if (!assignedUserId) return false
  return assignedUserId.toString() === currentUserId.toString()
}

const notifyTaskCompletion = async ({ userId, book, version, actionLabel, metadata = {} }) => {
  if (!userId || !book || !version) return

  await createNotification({
    userId,
    type: 'task',
    title: 'Task completed successfully',
    message: `${actionLabel} completed for ${book.title} (${version.language}).`,
    metadata: {
      bookId: book._id,
      versionId: version._id,
      language: version.language,
      ...metadata
    }
  })
}

const hasConflictingActiveCheckingClaim = async (checkerId, exclude = null) => {
  const activeClaim = await Claim.findOne({
    claimedBy: checkerId,
    claimType: 'checking',
    status: 'active'
  }).populate('book', 'title')

  if (!activeClaim) {
    return null
  }

  const claimBookId = activeClaim.book?._id?.toString() || activeClaim.book?.toString() || ''
  const claimLanguage = activeClaim.language || ''
  const isExcluded =
    exclude &&
    claimBookId === exclude.bookId?.toString() &&
    claimLanguage === exclude.language

  if (isExcluded) {
    return null
  }

  return activeClaim
}

// ── Add a new book (admin only) ────────────────────────────
const addBook = async (req, res) => {
  try {
    const { title, bookNumber, description } = req.body

    const existing = await Book.findOne({ bookNumber })
    if (existing) {
      return res.status(400).json({ message: `Book number ${bookNumber} already exists` })
    }

    const languageVersions = BOOK_LANGUAGES.map((language) => ({
      language,
      textStatus: 'not_started',
      audioStatus: 'not_started',
      currentStage: 'translation'
    }))

    const book = await Book.create({
      title,
      bookNumber,
      description,
      languageVersions,
      createdBy: req.user._id
    })

    // Do not block book creation if invitation dispatch fails.
    let inviteSummary = null
    try {
      inviteSummary = await sendTranslationClaimInvites(book)
    } catch (mailError) {
      console.error('Translation invite dispatch error:', mailError.message)
    }

    res.status(201).json({ message: 'Book added successfully', book, inviteSummary })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Get all books ──────────────────────────────────────────
const getAllBooks = async (req, res) => {
  try {
    const books = await Book.find()
      .populate('createdBy', 'name email')
      .select('-languageVersions')
    res.status(200).json(books)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Get single book ────────────────────────────────────────
const getBookById = async (req, res) => {
  try {
    const book = await Book.findById(req.params.bookId)
      .populate('createdBy', 'name email')
      .populate('languageVersions.assignedTranslator', 'name email')
      .populate('languageVersions.assignedChecker', 'name email')
      .populate('languageVersions.assignedRecorder', 'name email')
      .populate('languageVersions.assignedAudioChecker', 'name email')
      .populate('languageVersions.spoc', 'name email')

    if (!book) return res.status(404).json({ message: 'Book not found' })
    res.status(200).json(book)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Get my assigned books ──────────────────────────────────
const getMyAssignedBooks = async (req, res) => {
  try {
    const userId = req.user._id
    let query = {
      $or: [
        { 'languageVersions.assignedTranslator': userId },
        { 'languageVersions.assignedChecker': userId },
        { 'languageVersions.assignedRecorder': userId },
        { 'languageVersions.assignedAudioChecker': userId }
      ]
    }

    if (req.user.role === 'translator') {
      query = {
        languageVersions: {
          $elemMatch: {
            assignedTranslator: userId,
            currentStage: 'translation',
            textStatus: { $in: ['translation_in_progress', 'not_started'] }
          }
        }
      }
    } else if (req.user.role === 'checker') {
      query = {
        languageVersions: {
          $elemMatch: {
            assignedChecker: userId,
            currentStage: 'checking',
            textStatus: { $in: ['translation_submitted', 'checking_in_progress'] }
          }
        }
      }
    } else if (req.user.role === 'recorder') {
      query = {
        languageVersions: {
          $elemMatch: {
            assignedRecorder: userId,
            currentStage: 'audio_generation',
            audioStatus: { $in: ['audio_generated'] }
          }
        }
      }
    } else if (req.user.role === 'audio_checker') {
      query = {
        languageVersions: {
          $elemMatch: {
            assignedAudioChecker: userId,
            currentStage: 'audio_checking',
            audioStatus: { $in: ['audio_submitted', 'audio_checking_in_progress'] }
          }
        }
      }
    }

    const books = await Book.find(query).populate('createdBy', 'name email')
    res.status(200).json(books)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const uploadTranslationDocument = async (req, res) => {
  try {
    const files = normalizeUploadedTranslationFiles(req)

    if (files.length === 0) {
      return res.status(400).json({ message: 'Please upload at least one PDF, DOC, DOCX, or TXT file' })
    }

    let uploadedFiles = []

    if (isCloudinaryConfigured()) {
      uploadedFiles = await Promise.all(files.map(async (item) => {
        try {
          const uploadResult = await uploadFileToCloudinary({
            filePath: item.path,
            folder: process.env.CLOUDINARY_TRANSLATION_FOLDER || 'shantikunj/translations',
            resourceType: 'raw'
          })

          return {
            fileUrl: uploadResult.secure_url,
            filename: item.originalname,
            originalFilename: item.originalname,
            size: uploadResult.bytes,
            bytes: uploadResult.bytes,
            provider: 'cloudinary',
            publicId: uploadResult.public_id,
            resourceType: uploadResult.resource_type,
            format: uploadResult.format || null,
            uploadedAt: uploadResult.created_at || new Date().toISOString()
          }
        } finally {
          await removeLocalFile(item.path)
        }
      }))
    } else {
      uploadedFiles = files.map((item) => ({
        fileUrl: `${req.protocol}://${req.get('host')}/uploads/translations/${item.filename}`,
        filename: item.originalname,
        originalFilename: item.originalname,
        size: item.size,
        bytes: item.size,
        provider: 'local',
        publicId: null,
        resourceType: 'raw',
        format: null,
        uploadedAt: new Date().toISOString()
      }))
    }

    return res.status(200).json({
      message: uploadedFiles.length === 1
        ? 'Document uploaded successfully'
        : `${uploadedFiles.length} documents uploaded successfully`,
      fileUrl: uploadedFiles[0].fileUrl,
      files: uploadedFiles
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const uploadAudioFile = async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : []
    if (files.length === 0) {
      return res.status(400).json({ message: 'Please upload at least one MP3 or MP4 file' })
    }

    let uploadedFiles = []

    if (isCloudinaryConfigured()) {
      uploadedFiles = await Promise.all(files.map(async (file) => {
        try {
          const uploadResult = await uploadFileToCloudinary({
            filePath: file.path,
            folder: process.env.CLOUDINARY_AUDIO_FOLDER || 'shantikunj/audio',
            resourceType: 'video'
          })

          return {
            fileUrl: uploadResult.secure_url,
            filename: file.originalname,
            originalFilename: file.originalname,
            size: uploadResult.bytes,
            bytes: uploadResult.bytes,
            provider: 'cloudinary',
            publicId: uploadResult.public_id,
            resourceType: uploadResult.resource_type,
            format: uploadResult.format || null,
            uploadedAt: uploadResult.created_at || new Date().toISOString()
          }
        } finally {
          await removeLocalFile(file.path)
        }
      }))
    } else {
      uploadedFiles = files.map((file) => ({
        fileUrl: `${req.protocol}://${req.get('host')}/uploads/audio/${file.filename}`,
        filename: file.originalname,
        originalFilename: file.originalname,
        size: file.size,
        bytes: file.size,
        provider: 'local',
        publicId: null,
        resourceType: 'video',
        format: null,
        uploadedAt: new Date().toISOString()
      }))
    }

    return res.status(200).json({
      message: 'Audio uploaded successfully',
      fileUrl: uploadedFiles[0].fileUrl,
      files: uploadedFiles
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Translator submits translation ─────────────────────────
const submitTranslation = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { textFileUrl, textFileUrls, textFiles, textFileMeta, textFilesMeta } = req.body

    const validDocumentUrls = normalizeDocumentUrls({ textFileUrl, textFileUrls, textFiles })
    const documentMeta = buildFileMetadata({
      metaSources: [textFiles, textFileMeta, textFilesMeta],
      validUrls: validDocumentUrls,
      linkValidator: isDocumentLink
    })

    if (validDocumentUrls.length === 0) {
      return res.status(400).json({
        message: 'Please provide a valid document link (PDF/DOC/DOCX/TXT or Google Drive link)'
      })
    }

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (version.currentStage !== 'translation' || version.textStatus !== 'translation_in_progress') {
      return res.status(400).json({ message: 'This version is not ready for translation submission' })
    }

    // Only assigned translator can submit
    if (!isSameUser(version.assignedTranslator, req.user._id)) {
      return res.status(403).json({ message: 'You are not assigned as translator for this book' })
    }

    version.textStatus = 'translation_submitted'
    version.textFileUrl = validDocumentUrls[0]
    version.textFileUrls = validDocumentUrls
    version.textFileMeta = documentMeta
    version.currentStage = 'checking'
    version.isLocked = false
    version.lockedBy = null
    version.lockedUntil = null
    await book.save()

    // Update claim status
    await Claim.findOneAndUpdate(
      { book: bookId, language: version.language, claimType: 'translation', status: 'active' },
      { status: 'submitted' }
    )

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'Translation submission',
      metadata: { claimType: 'translation' }
    })

    await logAudit({
      req,
      action: 'translation_submitted',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: 'translation_in_progress',
      toState: 'translation_submitted'
    })

    res.status(200).json({ message: 'Translation submitted successfully!', version })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Checker submits vetted text ────────────────────────────
const submitVettedText = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { textFileUrl, decision = 'approved', feedback } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (version.currentStage !== 'checking' || version.textStatus !== 'checking_in_progress') {
      return res.status(400).json({ message: 'This version is not ready for checker submission' })
    }

    if (!isSameUser(version.assignedChecker, req.user._id)) {
      return res.status(403).json({ message: 'You are not assigned as checker for this book' })
    }

    if (!['approved', 'revision'].includes(decision)) {
      return res.status(400).json({ message: 'Invalid decision. Use approved or revision' })
    }

    if (decision === 'revision' && !(feedback || '').trim()) {
      return res.status(400).json({ message: 'Feedback is required when sending for revision' })
    }

    if (decision === 'approved') {
      const checkerActionAt = new Date()
      version.textStatus = 'checking_submitted'
      version.textFileUrl = textFileUrl || null
      version.currentStage = 'spoc_review'
      version.feedback = (feedback || '').trim() || null
      version.lastCheckedBy = req.user._id
      version.lastCheckedAt = checkerActionAt
      version.checkerApprovedAt = checkerActionAt
      version.isLocked = false
      version.lockedBy = null
      version.lockedUntil = null
      await book.save()

      await Claim.findOneAndUpdate(
        { book: bookId, language: version.language, claimType: 'checking', status: 'active' },
        { status: 'submitted' }
      )

      await logAudit({
        req,
        action: 'text_check_submitted',
        entityType: 'book_version',
        entityId: version._id,
        book: book._id,
        versionId: version._id,
        language: version.language,
        fromState: 'checking_in_progress',
        toState: 'checking_submitted'
      })

      // Notify SPOC
      const spoc = await User.findOne({
        language: version.language,
        role: 'spoc',
        status: 'approved'
      })

      if (spoc) {
        await sendMail({
          to: spoc.email,
          subject: `Text Ready for Review — ${book.title} (${version.language})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
              <p>Pranam <strong>${spoc.name}</strong>,</p>
              <p>The following book text is ready for your review:</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <strong>Book:</strong> ${book.title}<br/>
                <strong>Language:</strong> ${version.language}
              </div>
              <p>Please login to review and approve or reject.</p>
              <a href="http://localhost:5173"
                 style="background: #1D9E75; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Login to Review
              </a>
            </div>
          `
        })

        await createNotification({
          userId: spoc._id,
          type: 'task',
          title: 'Text ready for SPOC review',
          message: `${book.title} (${version.language}) needs your approval.`,
          metadata: { bookId: book._id, versionId: version._id }
        })
      }

      await notifyTaskCompletion({
        userId: req.user._id,
        book,
        version,
        actionLabel: 'Text vetting',
        metadata: { claimType: 'checking', decision: 'approved' }
      })

      return res.status(200).json({ message: 'Text approved and sent to SPOC review.', version })
    }

    const checkerFeedback = (feedback || '').trim()
    const checkerActionAt = new Date()

    version.feedback = checkerFeedback
    version.currentStage = 'translation'
    version.textStatus = 'translation_in_progress'
    version.textRejectionCount += 1
    version.reassignmentCount += 1
    version.lastCheckedBy = req.user._id
    version.lastCheckedAt = checkerActionAt
    version.checkerRevisionSentAt = checkerActionAt
    version.isLocked = false
    version.lockedBy = null
    version.lockedUntil = null
    version.assignedChecker = null
    version.checkerDeadline = null
    if (textFileUrl) {
      version.textFileUrl = textFileUrl
    }
    await book.save()

    await Claim.findOneAndUpdate(
      { book: bookId, language: version.language, claimType: 'checking', status: 'active' },
      { status: 'submitted' }
    )

    await logAudit({
      req,
      action: 'text_sent_back_to_translator',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: 'checking_in_progress',
      toState: 'translation_in_progress',
      note: checkerFeedback
    })

    const translator = version.assignedTranslator ? await User.findById(version.assignedTranslator) : null
    if (translator) {
      await sendMail({
        to: translator.email,
        subject: `Text Revision Required — ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #E24B4A;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${translator.name}</strong>,</p>
            <p>Your translated text needs revision after text vetting.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Language:</strong> ${version.language}<br/>
              <strong>Checker Feedback:</strong><br/>
              <p style="color: #E24B4A;">${checkerFeedback}</p>
            </div>
            <a href="http://localhost:5173"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Revise
            </a>
          </div>
        `
      })

      await createNotification({
        userId: translator._id,
        type: 'feedback',
        title: 'Text revision requested by checker',
        message: `${book.title} (${version.language}) was sent back with corrections.`,
        metadata: { bookId: book._id, versionId: version._id }
      })
    }

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'Text review and revision feedback',
      metadata: { claimType: 'checking', decision: 'revision' }
    })

    return res.status(200).json({ message: 'Text sent back to translator for revision.', version })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── SPOC reviews text ──────────────────────────────────────
const spocReviewText = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { decision, feedback } = req.body
    const normalizedDecision = String(decision || 'approved').toLowerCase()
    const reviewFeedback = (feedback || '').trim()

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.language !== version.language) {
      return res.status(403).json({ message: `You can only review books for: ${req.user.language}` })
    }

    const hasTextForReview =
      Boolean(String(version.textFileUrl || '').trim()) ||
      (Array.isArray(version.textFileUrls) && version.textFileUrls.some((item) => Boolean(String(item || '').trim())))

    const isStrictReady = version.currentStage === 'spoc_review' && version.textStatus === 'checking_submitted'
    const isLegacyReady = version.currentStage === 'spoc_review' && version.textStatus === 'checking_in_progress' && hasTextForReview

    if (!isStrictReady && !isLegacyReady) {
      return res.status(400).json({ message: 'Text is not ready for SPOC review' })
    }

    const fromTextState = version.textStatus

    if (isLegacyReady) {
      version.textStatus = 'checking_submitted'
    }

    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      return res.status(400).json({ message: 'Invalid decision. Use approved or rejected' })
    }

    if (normalizedDecision === 'rejected' && !reviewFeedback) {
      return res.status(400).json({ message: 'Feedback is required when rejecting and sending back to translator' })
    }

    if (normalizedDecision === 'approved') {
      version.textStatus = 'text_approved'
      version.currentStage = 'audio_generation'
      version.feedback = null
      await book.save()

      // Notify recorder team
      const recorders = await User.find({
        language: version.language,
        role: 'recorder',
        status: 'approved'
      })

      for (const recorder of recorders) {
        await sendMail({
          to: recorder.email,
          subject: `Text Approved — Audio Generation Ready — ${book.title} (${version.language})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
              <p>Pranam <strong>${recorder.name}</strong>,</p>
              <p>The text for the following book has been approved and is ready for audio generation:</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
                <strong>Book:</strong> ${book.title}<br/>
                <strong>Language:</strong> ${version.language}
              </div>
              <p>Please login to claim and start audio generation.</p>
              <a href="http://localhost:5173"
                 style="background: #1D9E75; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Login to Claim
              </a>
            </div>
          `
        })
      }

      await createBulkNotifications({
        userIds: recorders.map((recorder) => recorder._id),
        type: 'task',
        title: 'Text approved, audio generation open',
        message: `${book.title} (${version.language}) is ready for recording claim.`,
        metadata: { bookId: book._id, versionId: version._id }
      })

      await logAudit({
        req,
        action: 'spoc_text_approved',
        entityType: 'book_version',
        entityId: version._id,
        book: book._id,
        versionId: version._id,
        language: version.language,
        fromState: fromTextState,
        toState: 'text_approved'
      })

      await notifyTaskCompletion({
        userId: req.user._id,
        book,
        version,
        actionLabel: 'SPOC text approval',
        metadata: { decision: 'approved' }
      })

      return res.status(200).json({
        message: 'Text approved and sent to audio recorder team.',
        version
      })
    }

    version.textStatus = 'translation_in_progress'
    version.currentStage = 'translation'
    version.feedback = reviewFeedback
    version.reassignmentCount += 1
    version.textRejectionCount += 1
    version.assignedChecker = null
    version.checkerDeadline = null
    await book.save()

    const translator = version.assignedTranslator ? await User.findById(version.assignedTranslator) : null
    if (translator) {
      await sendMail({
        to: translator.email,
        subject: `Text Revision Required by SPOC — ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #E24B4A;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${translator.name}</strong>,</p>
            <p>The translated text needs revision based on SPOC review.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Language:</strong> ${version.language}<br/>
              <strong>SPOC Feedback:</strong><br/>
              <p style="color: #E24B4A;">${reviewFeedback}</p>
            </div>
            <a href="http://localhost:5173"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Revise
            </a>
          </div>
        `
      })

      await createNotification({
        userId: translator._id,
        type: 'feedback',
        title: 'Text revision requested by SPOC',
        message: `${book.title} (${version.language}) was sent back with SPOC feedback.`,
        metadata: { bookId: book._id, versionId: version._id }
      })
    }

    await logAudit({
      req,
      action: 'spoc_text_rejected',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: fromTextState,
      toState: 'translation_in_progress',
      note: reviewFeedback
    })

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'SPOC text review',
      metadata: { decision: 'rejected' }
    })

    return res.status(200).json({
      message: 'Text sent back to translator with SPOC feedback.',
      version
    })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Recorder submits audio ─────────────────────────────────
const submitAudio = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { audioUrl, audioUrls, audioFiles, audioFileMeta, audioFilesMeta } = req.body
    const normalizedAudioUrls = normalizeAudioUrls({ audioUrl, audioUrls, audioFiles })
    const audioMeta = buildFileMetadata({
      metaSources: [audioFiles, audioFileMeta, audioFilesMeta],
      validUrls: normalizedAudioUrls,
      linkValidator: isAudioLink
    })

    if (normalizedAudioUrls.length === 0) {
      return res.status(400).json({
        message: 'Please provide at least one valid audio link (MP3/MP4 or Google Drive link)'
      })
    }

    const hasInvalidAudioLink = normalizedAudioUrls.some((url) => !isValidHttpUrl(url) || !isAudioLink(url))
    if (hasInvalidAudioLink) {
      return res.status(400).json({
        message: 'One or more audio links are invalid. Please use MP3/MP4 or Google Drive links.'
      })
    }

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (version.currentStage !== 'audio_generation' || version.audioStatus !== 'audio_generated') {
      return res.status(400).json({ message: 'This version is not ready for audio submission' })
    }

    if (!isSameUser(version.assignedRecorder, req.user._id)) {
      return res.status(403).json({ message: 'You are not assigned as recorder for this book' })
    }

    version.audioStatus = 'audio_submitted'
    version.audioUrl = normalizedAudioUrls[0]
    version.audioFiles = normalizedAudioUrls
    version.audioFileMeta = audioMeta
    version.currentStage = 'audio_checking'
    version.isLocked = false
    version.lockedBy = null
    version.lockedUntil = null
    await book.save()

    await Claim.findOneAndUpdate(
      { book: bookId, language: version.language, claimType: 'audio', status: 'active' },
      { status: 'submitted' }
    )

    await logAudit({
      req,
      action: 'audio_submitted',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: 'audio_generated',
      toState: 'audio_submitted'
    })

    // Notify audio checkers for audio verification
    const checkers = await User.find({
      language: version.language,
      role: 'audio_checker',
      status: 'approved'
    })

    for (const checker of checkers) {
      await sendMail({
        to: checker.email,
        subject: `Audio Ready for Verification — ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${checker.name}</strong>,</p>
            <p>Audio is ready for verification:</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Language:</strong> ${version.language}
            </div>
            <p>Please login to claim and start audio verification.</p>
            <a href="http://localhost:5173"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Claim
            </a>
          </div>
        `
      })
    }

    await createBulkNotifications({
      userIds: checkers.map((checker) => checker._id),
      type: 'task',
      title: 'Audio verification task available',
      message: `${book.title} (${version.language}) audio is ready to verify.`,
      metadata: { bookId: book._id, versionId: version._id }
    })

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'Audio submission',
      metadata: { claimType: 'audio' }
    })

    res.status(200).json({ message: 'Audio submitted! Audio checker team notified.', version })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Checker submits audio review ───────────────────────────
const submitAudioReview = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { decision, feedback, feedbackDeadline } = req.body
    const normalizedDecision = String(decision || 'approved').toLowerCase()
    const checkerFeedback = (feedback || '').trim()

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (version.currentStage !== 'audio_checking' || version.audioStatus !== 'audio_checking_in_progress') {
      return res.status(400).json({ message: 'This version is not ready for audio checker submission' })
    }

    if (!isSameUser(version.assignedAudioChecker, req.user._id)) {
      return res.status(403).json({ message: 'You are not assigned as audio checker' })
    }

    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      return res.status(400).json({ message: 'Invalid decision. Use approved or rejected' })
    }

    if (normalizedDecision === 'rejected' && !checkerFeedback) {
      return res.status(400).json({ message: 'Feedback is required when rejecting audio' })
    }

    let parsedFeedbackDeadline = null
    if (normalizedDecision === 'approved') {
      if (!feedbackDeadline) {
        return res.status(400).json({ message: 'feedbackDeadline is required when approving audio' })
      }

      parsedFeedbackDeadline = new Date(feedbackDeadline)
      if (Number.isNaN(parsedFeedbackDeadline.getTime()) || parsedFeedbackDeadline <= new Date()) {
        return res.status(400).json({ message: 'feedbackDeadline must be a valid future datetime' })
      }

      version.audioStatus = 'audio_checking_submitted'
      version.currentStage = 'final_verification'
      version.feedback = checkerFeedback || null
      version.feedbackDeadline = parsedFeedbackDeadline
    } else {
      version.audioStatus = 'audio_generated'
      version.currentStage = 'audio_generation'
      version.feedback = checkerFeedback
      version.feedbackDeadline = null
      version.audioRejectionCount += 1
      version.reassignmentCount += 1
    }

    version.isBlockedBySpoc = false
    version.blockerNote = null
    version.isLocked = false
    version.lockedBy = null
    version.lockedUntil = null
    await book.save()

    await Claim.findOneAndUpdate(
      { book: bookId, language: version.language, claimType: 'audio_check', status: 'active' },
      { status: 'submitted' }
    )

    if (normalizedDecision === 'approved') {
      await logAudit({
        req,
        action: 'audio_check_submitted',
        entityType: 'book_version',
        entityId: version._id,
        book: book._id,
        versionId: version._id,
        language: version.language,
        fromState: 'audio_checking_in_progress',
        toState: 'audio_checking_submitted',
        metadata: { feedbackDeadline: parsedFeedbackDeadline }
      })

      // Notify SPOC
      const spoc = await User.findOne({
        language: version.language,
        role: 'spoc',
        status: 'approved'
      })

      if (spoc) {
        await sendMail({
          to: spoc.email,
          subject: `Audio Ready for Final Approval — ${book.title} (${version.language})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
              <p>Pranam <strong>${spoc.name}</strong>,</p>
              <p>Audio verification is complete and ready for your final approval:</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
                <strong>Book:</strong> ${book.title}<br/>
                <strong>Language:</strong> ${version.language}<br/>
                <strong>Feedback Deadline:</strong> ${parsedFeedbackDeadline.toLocaleString()}<br/>
                ${checkerFeedback ? `<strong>Checker Notes:</strong> ${checkerFeedback}` : ''}
              </div>
              <a href="http://localhost:5173"
                 style="background: #1D9E75; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Login to Approve
              </a>
            </div>
          `
        })

        await createNotification({
          userId: spoc._id,
          type: 'task',
          title: 'Audio ready for final approval',
          message: `${book.title} (${version.language}) is waiting for your final decision.`,
          metadata: { bookId: book._id, versionId: version._id, feedbackDeadline: parsedFeedbackDeadline }
        })
      }

      await notifyTaskCompletion({
        userId: req.user._id,
        book,
        version,
        actionLabel: 'Audio verification submission',
        metadata: { claimType: 'audio_check', decision: 'approved' }
      })

      return res.status(200).json({ message: 'Audio approved and sent to SPOC for final review.', version })
    }

    await logAudit({
      req,
      action: 'audio_sent_back_to_recorder',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: 'audio_checking_in_progress',
      toState: 'audio_generated',
      note: checkerFeedback
    })

    const recorder = version.assignedRecorder ? await User.findById(version.assignedRecorder) : null
    if (recorder) {
      await sendMail({
        to: recorder.email,
        subject: `Audio Revision Required — ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #E24B4A;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${recorder.name}</strong>,</p>
            <p>Your audio needs revision after audio checking.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Language:</strong> ${version.language}<br/>
              <strong>Audio Checker Feedback:</strong><br/>
              <p style="color: #E24B4A;">${checkerFeedback}</p>
            </div>
            <a href="http://localhost:5173"
               style="background: #1D9E75; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Revise
            </a>
          </div>
        `
      })

      await createNotification({
        userId: recorder._id,
        type: 'feedback',
        title: 'Audio revision requested by audio checker',
        message: `${book.title} (${version.language}) was sent back with audio correction notes.`,
        metadata: { bookId: book._id, versionId: version._id }
      })
    }

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'Audio review and revision feedback',
      metadata: { claimType: 'audio_check', decision: 'rejected' }
    })

    return res.status(200).json({ message: 'Audio rejected and sent back to recorder for revision.', version })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── SPOC final audio approval ──────────────────────────────
const spocAudioApproval = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { decision, feedback } = req.body
    const normalizedDecision = String(decision || 'approved').toLowerCase()
    const spocFeedback = (feedback || '').trim()

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.language !== version.language) {
      return res.status(403).json({ message: `You can only approve for: ${req.user.language}` })
    }

    if (version.currentStage !== 'final_verification' || version.audioStatus !== 'audio_checking_submitted') {
      return res.status(400).json({ message: 'Audio is not ready for SPOC final approval' })
    }

    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      return res.status(400).json({ message: 'Invalid decision. Use approved or rejected' })
    }

    if (normalizedDecision === 'rejected' && !spocFeedback) {
      return res.status(400).json({ message: 'Feedback is required when rejecting and sending back to recorder' })
    }

    if (normalizedDecision === 'approved') {
      version.audioStatus = 'audio_approved'
      version.currentStage = 'final_verification'
      version.feedback = null
      version.isBlockedBySpoc = false
      version.blockerNote = null
      await book.save()

      // Send approved audio to admin publish queue.
      const admins = await User.find({
        role: 'admin',
        status: 'approved',
        isActive: true
      })

      for (const admin of admins) {
        await sendMail({
          to: admin.email,
          subject: `Audio Ready For Publish Approval — ${book.title} (${version.language})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
              <p>Pranam <strong>${admin.name}</strong>,</p>
              <p>The audiobook has completed SPOC audio approval and is ready for admin publishing:</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
                <strong>Book:</strong> ${book.title}<br/>
                <strong>Language:</strong> ${version.language}<br/>
                <strong>Audio Status:</strong> ${version.audioStatus.replaceAll('_', ' ')}<br/>
                <strong>Feedback Deadline:</strong> ${version.feedbackDeadline ? new Date(version.feedbackDeadline).toLocaleString() : 'Not set'}
              </div>
              <p>Please review and publish from the admin dashboard when ready.</p>
              <a href="http://localhost:5173"
                 style="background: #1D9E75; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Open Admin Dashboard
              </a>
            </div>
          `
        })
      }

      await createBulkNotifications({
        userIds: admins.map((admin) => admin._id),
        type: 'task',
        title: 'Audio ready for publish review',
        message: `${book.title} (${version.language}) is SPOC-approved and awaiting publish action.`,
        metadata: { bookId: book._id, versionId: version._id, audioStatus: version.audioStatus }
      })

      await logAudit({
        req,
        action: 'spoc_audio_approved',
        entityType: 'book_version',
        entityId: version._id,
        book: book._id,
        versionId: version._id,
        language: version.language,
        fromState: 'audio_checking_submitted',
        toState: 'audio_approved'
      })

      await notifyTaskCompletion({
        userId: req.user._id,
        book,
        version,
        actionLabel: 'SPOC audio approval',
        metadata: { decision: 'approved' }
      })

      return res.status(200).json({
        message: `Audio approved and sent to admin publish queue (${admins.length} admins notified).`,
        version
      })
    }

    if (normalizedDecision === 'rejected') {
      version.audioStatus = 'audio_generated'
      version.currentStage = 'audio_generation'
      version.feedback = spocFeedback
      version.reassignmentCount += 1
      version.audioRejectionCount += 1
      version.feedbackDeadline = null
      version.assignedAudioChecker = null
      version.audioCheckerDeadline = null
      await book.save()

      // Send back to same recorder
      const recorder = await User.findById(version.assignedRecorder)
      if (recorder) {
        await sendMail({
          to: recorder.email,
          subject: `Audio Revision Required — ${book.title} (${version.language})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #E24B4A;">Shantikunj Audiobooks LMS</h2>
              <p>Pranam <strong>${recorder.name}</strong>,</p>
              <p>Your audio submission needs revision:</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px;">
                <strong>Book:</strong> ${book.title}<br/>
                <strong>Language:</strong> ${version.language}<br/>
                <strong>Feedback:</strong><br/>
                <p style="color: #E24B4A;">${spocFeedback}</p>
              </div>
              <a href="http://localhost:5173"
                 style="background: #1D9E75; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Login to Revise
              </a>
            </div>
          `
        })

        await createNotification({
          userId: recorder._id,
          type: 'feedback',
          title: 'Audio revision requested',
          message: `${book.title} (${version.language}) audio needs corrections.`,
          metadata: { bookId: book._id, versionId: version._id }
        })
      }

      await logAudit({
        req,
        action: 'spoc_audio_rejected',
        entityType: 'book_version',
        entityId: version._id,
        book: book._id,
        versionId: version._id,
        language: version.language,
        fromState: 'audio_checking_submitted',
        toState: 'audio_generated',
        note: spocFeedback
      })

      await notifyTaskCompletion({
        userId: req.user._id,
        book,
        version,
        actionLabel: 'SPOC audio review',
        metadata: { decision: 'rejected' }
      })

      return res.status(200).json({
        message: 'Audio rejected and sent back to recorder with SPOC feedback.',
        version
      })
    }

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Admin publishes book version ───────────────────────────
const publishBook = async (req, res) => {
  try {
    const { bookId, versionId } = req.params

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (version.audioStatus !== 'audio_approved') {
      return res.status(400).json({ message: 'Only SPOC-approved audio can be published' })
    }

    if (version.isBlockedBySpoc) {
      return res.status(400).json({ message: 'Cannot publish while SPOC blocker is active' })
    }

    version.audioStatus = 'published'
    version.currentStage = 'published'
    version.isLocked = false
    await book.save()

    // Notify entire language team
    const teamMembers = await User.find({
      language: version.language,
      status: 'approved',
      isActive: true
    })

    for (const member of teamMembers) {
      await sendMail({
        to: member.email,
        subject: `🎉 Published! — ${book.title} (${version.language})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #1D9E75;">Shantikunj Audiobooks LMS</h2>
            <p>Pranam <strong>${member.name}</strong>,</p>
            <p>🎉 The following audiobook has been officially published!</p>
            <div style="background: #E1F5EE; padding: 16px; border-radius: 8px;">
              <strong>Book:</strong> ${book.title}<br/>
              <strong>Language:</strong> ${version.language}
            </div>
            <p>Thank you for your contribution to this divine work! 🙏</p>
          </div>
        `
      })
    }

    await createBulkNotifications({
      userIds: teamMembers.map((member) => member._id),
      type: 'system',
      title: 'Audiobook published',
      message: `${book.title} (${version.language}) is now published.`,
      metadata: { bookId: book._id, versionId: version._id }
    })

    await logAudit({
      req,
      action: 'book_version_published',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      fromState: 'audio_approved',
      toState: 'published'
    })

    await notifyTaskCompletion({
      userId: req.user._id,
      book,
      version,
      actionLabel: 'Publishing',
      metadata: { decision: 'published' }
    })

    res.status(200).json({
      message: `${book.title} (${version.language}) published successfully! 🎉`,
      version
    })

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Update text status (manual) ────────────────────────────
const updateTextStatus = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { textStatus, feedback } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    version.textStatus = textStatus
    if (feedback) version.feedback = feedback
    await book.save()

    res.status(200).json({ message: 'Text status updated', version })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Update audio status (manual) ───────────────────────────
const updateAudioStatus = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { audioStatus, audioUrl, audioUrls, feedback } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    version.audioStatus = audioStatus
    const normalizedAudioUrls = normalizeAudioUrls({ audioUrl, audioUrls })
    if (normalizedAudioUrls.length > 0) {
      version.audioUrl = normalizedAudioUrls[0]
      version.audioFiles = normalizedAudioUrls
    }
    if (feedback) version.feedback = feedback
    await book.save()

    res.status(200).json({ message: 'Audio status updated', version })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Assign to checker (admin/spoc) ─────────────────────────
const assignToChecker = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { checkerId, deadline } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.role === 'spoc' && req.user.language !== version.language) {
      return res.status(403).json({ message: `You can only assign for: ${req.user.language}` })
    }

    const checker = await User.findById(checkerId)
    if (!checker || checker.role !== 'checker' || checker.status !== 'approved' || !checker.isActive) {
      return res.status(400).json({ message: 'Selected user is not an active approved checker' })
    }

    if (checker.language !== version.language) {
      return res.status(400).json({ message: 'Selected checker must belong to the same language' })
    }

    const parsedDeadline = new Date(deadline)
    if (Number.isNaN(parsedDeadline.getTime()) || parsedDeadline <= new Date()) {
      return res.status(400).json({ message: 'deadline must be a valid future datetime' })
    }

    const conflictingClaim = await hasConflictingActiveCheckingClaim(checker._id, {
      bookId: book._id,
      language: version.language
    })

    if (conflictingClaim) {
      return res.status(400).json({
        message: `Selected checker already has an active checking claim for ${conflictingClaim.book?.title || 'another book'}.`
      })
    }

    const now = new Date()
    const msInDay = 1000 * 60 * 60 * 24
    const daysCommitted = Math.max(1, Math.ceil((parsedDeadline - now) / msInDay))

    await Claim.updateMany(
      {
        book: book._id,
        language: version.language,
        claimType: 'checking',
        status: 'active'
      },
      { status: 'released' }
    )

    await Claim.create({
      book: book._id,
      language: version.language,
      claimedBy: checker._id,
      claimType: 'checking',
      daysCommitted,
      deadline: parsedDeadline,
      status: 'active'
    })

    version.assignedChecker = checker._id
    version.checkerDeadline = parsedDeadline
    version.textStatus = 'checking_in_progress'
    version.currentStage = 'checking'
    version.isLocked = true
    version.lockedBy = checker._id
    version.lockedUntil = parsedDeadline
    await book.save()

    res.status(200).json({ message: 'Book version assigned to checker', version })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const setSpocBlocker = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { isBlocked, blockerNote } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.language !== version.language) {
      return res.status(403).json({ message: `You can only manage blocker for: ${req.user.language}` })
    }

    version.isBlockedBySpoc = Boolean(isBlocked)
    version.blockerNote = isBlocked ? (blockerNote || 'Blocked by SPOC') : null
    await book.save()

    await logAudit({
      req,
      action: version.isBlockedBySpoc ? 'spoc_blocker_enabled' : 'spoc_blocker_removed',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      note: version.blockerNote
    })

    return res.status(200).json({
      message: version.isBlockedBySpoc ? 'Blocker enabled' : 'Blocker removed',
      version
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const reassignAfterRejections = async (req, res) => {
  try {
    const { bookId, versionId } = req.params
    const { assignmentType, newUserId, deadline } = req.body

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const version = book.languageVersions.id(versionId)
    if (!version) return res.status(404).json({ message: 'Language version not found' })

    if (req.user.role === 'spoc' && req.user.language !== version.language) {
      return res.status(403).json({ message: `You can only reassign for: ${req.user.language}` })
    }

    const parsedDeadline = new Date(deadline)
    if (Number.isNaN(parsedDeadline.getTime()) || parsedDeadline <= new Date()) {
      return res.status(400).json({ message: 'deadline must be a valid future datetime' })
    }

    const newAssignee = await User.findById(newUserId)
    if (!newAssignee || newAssignee.status !== 'approved' || !newAssignee.isActive) {
      return res.status(404).json({ message: 'New assignee is not available' })
    }

    if (newAssignee.language !== version.language) {
      return res.status(400).json({ message: 'New assignee must belong to the same language' })
    }

    if (assignmentType === 'checker') {
      if (version.textRejectionCount < REASSIGNMENT_THRESHOLD) {
        return res.status(400).json({
          message: `Checker reassignment is allowed after ${REASSIGNMENT_THRESHOLD} text rejections`
        })
      }

      if (newAssignee.role !== 'checker') {
        return res.status(400).json({ message: 'Selected user is not a checker' })
      }

      const conflictingClaim = await hasConflictingActiveCheckingClaim(newAssignee._id, {
        bookId: book._id,
        language: version.language
      })

      if (conflictingClaim) {
        return res.status(400).json({
          message: `Selected checker already has an active checking claim for ${conflictingClaim.book?.title || 'another book'}.`
        })
      }

      await Claim.findOneAndUpdate(
        {
          book: book._id,
          language: version.language,
          claimType: 'checking',
          status: 'active'
        },
        { status: 'released' }
      )

      const daysCommitted = Math.max(1, Math.ceil((parsedDeadline - new Date()) / (1000 * 60 * 60 * 24)))
      await Claim.create({
        book: book._id,
        language: version.language,
        claimedBy: newAssignee._id,
        claimType: 'checking',
        daysCommitted,
        deadline: parsedDeadline,
        status: 'active'
      })

      version.assignedChecker = newAssignee._id
      version.checkerDeadline = parsedDeadline
      version.textStatus = 'checking_in_progress'
      version.currentStage = 'checking'
      version.isLocked = true
      version.lockedBy = newAssignee._id
      version.lockedUntil = parsedDeadline
    } else if (assignmentType === 'recorder') {
      if (version.audioRejectionCount < REASSIGNMENT_THRESHOLD) {
        return res.status(400).json({
          message: `Recorder reassignment is allowed after ${REASSIGNMENT_THRESHOLD} audio rejections`
        })
      }

      if (newAssignee.role !== 'recorder') {
        return res.status(400).json({ message: 'Selected user is not a recorder' })
      }

      await Claim.findOneAndUpdate(
        {
          book: book._id,
          language: version.language,
          claimType: 'audio',
          status: 'active'
        },
        { status: 'released' }
      )

      const daysCommitted = Math.max(1, Math.ceil((parsedDeadline - new Date()) / (1000 * 60 * 60 * 24)))
      await Claim.create({
        book: book._id,
        language: version.language,
        claimedBy: newAssignee._id,
        claimType: 'audio',
        daysCommitted,
        deadline: parsedDeadline,
        status: 'active'
      })

      version.assignedRecorder = newAssignee._id
      version.recorderDeadline = parsedDeadline
      version.audioStatus = 'audio_generated'
      version.currentStage = 'audio_generation'
      version.isLocked = true
      version.lockedBy = newAssignee._id
      version.lockedUntil = parsedDeadline
      version.feedbackDeadline = null
      version.isBlockedBySpoc = false
      version.blockerNote = null
    } else {
      return res.status(400).json({ message: 'assignmentType must be checker or recorder' })
    }

    await book.save()

    await logAudit({
      req,
      action: 'task_reassigned_after_rejections',
      entityType: 'book_version',
      entityId: version._id,
      book: book._id,
      versionId: version._id,
      language: version.language,
      metadata: { assignmentType, newUserId, deadline: parsedDeadline }
    })

    return res.status(200).json({ message: 'Reassignment completed', version })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  addBook,
  getAllBooks,
  getBookById,
  uploadTranslationDocument,
  uploadAudioFile,
  assignToChecker,
  reassignAfterRejections,
  setSpocBlocker,
  updateTextStatus,
  updateAudioStatus,
  getMyAssignedBooks,
  submitTranslation,
  submitVettedText,
  spocReviewText,
  submitAudio,
  submitAudioReview,
  spocAudioApproval,
  publishBook
}
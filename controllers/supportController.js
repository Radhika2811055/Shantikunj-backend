const SupportRequest = require('../models/SupportRequest')
const SupportContact = require('../models/SupportContact')
const User = require('../models/User')
const { createBulkNotifications } = require('../services/notificationService')
const { logAudit } = require('../services/auditService')

const getSupportContactInfo = async (_req, res) => {
  try {
    const contact = await SupportContact.findOne().sort({ updatedAt: -1 })

    return res.status(200).json({
      supportContact: contact || {
        name: null,
        email: null,
        phone: null,
        whatsapp: null,
        workingHours: null,
        note: 'Support contact details will be configured by admin.'
      }
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const upsertSupportContactInfo = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      whatsapp,
      workingHours,
      note
    } = req.body || {}

    const payload = {
      name: name || null,
      email: email || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      workingHours: workingHours || null,
      note: note || null,
      updatedBy: req.user._id
    }

    const existing = await SupportContact.findOne().sort({ updatedAt: -1 })
    let supportContact = null

    if (existing) {
      existing.set(payload)
      supportContact = await existing.save()
    } else {
      supportContact = await SupportContact.create(payload)
    }

    await logAudit({
      req,
      action: 'support_contact_updated',
      entityType: 'support_request',
      entityId: supportContact._id,
      metadata: {
        hasEmail: Boolean(supportContact.email),
        hasPhone: Boolean(supportContact.phone)
      }
    })

    return res.status(200).json({
      message: 'Support contact information updated successfully',
      supportContact
    })
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const createSupportRequest = async (req, res) => {
  try {
    const {
      requestType,
      category,
      subject,
      description,
      phone,
      preferredCallTime
    } = req.body

    if (!subject || !description) {
      return res.status(400).json({ message: 'Subject and description are required' })
    }

    if (requestType === 'callback' && !phone) {
      return res.status(400).json({ message: 'Phone is required for callback requests' })
    }

    const supportRequest = await SupportRequest.create({
      requester: req.user._id,
      language: req.user.language,
      requestType: requestType || 'support',
      category: category || 'other',
      subject,
      description,
      phone: phone || null,
      preferredCallTime: preferredCallTime || null
    })

    const managers = await User.find({
      status: 'approved',
      isActive: true,
      $or: [
        { role: 'admin' },
        { role: 'spoc', language: req.user.language }
      ]
    }).select('_id')

    await createBulkNotifications({
      userIds: managers.map((manager) => manager._id),
      type: 'support',
      title: `${requestType || 'support'} request created`,
      message: `${req.user.name} raised a ${requestType || 'support'} request in ${req.user.language || 'general'} language.`,
      metadata: { supportRequestId: supportRequest._id }
    })

    await logAudit({
      req,
      action: 'support_request_created',
      entityType: 'support_request',
      entityId: supportRequest._id,
      language: supportRequest.language,
      note: `${supportRequest.requestType} request created`,
      metadata: { category: supportRequest.category }
    })

    res.status(201).json({
      message: 'Support request created successfully',
      supportRequest
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getMySupportRequests = async (req, res) => {
  try {
    const requests = await SupportRequest.find({ requester: req.user._id })
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 })

    res.status(200).json(requests)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const getSupportRequestsForManagers = async (req, res) => {
  try {
    const filter = {}

    if (req.user.role === 'spoc') {
      filter.language = req.user.language
    }

    const requests = await SupportRequest.find(filter)
      .populate('requester', 'name email role language')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 })

    res.status(200).json(requests)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const updateSupportRequestStatus = async (req, res) => {
  try {
    const { requestId } = req.params
    const { status, resolutionNote, assignedTo } = req.body

    const supportRequest = await SupportRequest.findById(requestId)
    if (!supportRequest) {
      return res.status(404).json({ message: 'Support request not found' })
    }

    if (req.user.role === 'spoc' && supportRequest.language !== req.user.language) {
      return res.status(403).json({ message: 'You can only manage requests for your own language' })
    }

    if (status) supportRequest.status = status
    if (resolutionNote !== undefined) supportRequest.resolutionNote = resolutionNote
    if (assignedTo !== undefined) supportRequest.assignedTo = assignedTo

    if (status === 'resolved' || status === 'closed') {
      supportRequest.resolvedAt = new Date()
    }

    await supportRequest.save()

    await logAudit({
      req,
      action: 'support_request_updated',
      entityType: 'support_request',
      entityId: supportRequest._id,
      language: supportRequest.language,
      toState: supportRequest.status,
      note: resolutionNote || null,
      metadata: { assignedTo: supportRequest.assignedTo }
    })

    res.status(200).json({
      message: 'Support request updated successfully',
      supportRequest
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = {
  getSupportContactInfo,
  upsertSupportContactInfo,
  createSupportRequest,
  getMySupportRequests,
  getSupportRequestsForManagers,
  updateSupportRequestStatus
}

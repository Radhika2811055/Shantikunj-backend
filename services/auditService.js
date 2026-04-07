const AuditLog = require('../models/AuditLog')

const logAudit = async ({
  req,
  action,
  entityType = 'system',
  entityId = null,
  book = null,
  versionId = null,
  language = null,
  fromState = null,
  toState = null,
  note = null,
  metadata = {}
}) => {
  if (!action) return null

  try {
    return await AuditLog.create({
      actor: req?.user?._id || null,
      actorRole: req?.user?.role || null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      book,
      versionId,
      language,
      fromState,
      toState,
      note,
      metadata
    })
  } catch (_error) {
    return null
  }
}

module.exports = { logAudit }

const express = require('express')
const router = express.Router()
const { protect, authorise } = require('../middleware/authMiddleware')
const { getAuditLogs } = require('../controllers/auditController')

router.use(protect)
router.get('/', authorise('admin', 'spoc'), getAuditLogs)

module.exports = router

const express = require('express')
const router = express.Router()
const { protect, authorise } = require('../middleware/authMiddleware')
const {
  createSupportRequest,
  getMySupportRequests,
  getSupportRequestsForManagers,
  updateSupportRequestStatus
} = require('../controllers/supportController')

router.use(protect)

// Any approved user can raise support or callback request.
router.post('/', createSupportRequest)
router.get('/my', getMySupportRequests)

// SPOC and Admin can monitor and resolve requests.
router.get('/', authorise('admin', 'spoc'), getSupportRequestsForManagers)
router.put('/:requestId/status', authorise('admin', 'spoc'), updateSupportRequestStatus)

module.exports = router

const express = require('express')
const router = express.Router()
const { protect, authorise } = require('../middleware/authMiddleware')
const { 
  getPendingUsers, 
  approveUser, 
  rejectUser, 
  getAllUsers,
  deleteUser 
} = require('../controllers/adminController')

// All routes below require login + admin role
router.use(protect)
router.use(authorise('admin'))

router.get('/users/pending', getPendingUsers)
router.get('/users/all', getAllUsers)
router.put('/users/:userId/approve', approveUser)
router.put('/users/:userId/reject', rejectUser)
router.delete('/users/:userId', deleteUser)

module.exports = router
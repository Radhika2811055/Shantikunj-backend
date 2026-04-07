const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const dotenv = require('dotenv')
const User = require('./models/User')

dotenv.config()

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected!')

    // Check if admin already exists
    const existing = await User.findOne({ email: 'admin@shantikunj.com' })
    if (existing) {
      console.log('Admin already exists!')
      process.exit()
    }

    const hashedPassword = await bcrypt.hash('Admin@2026', 10)

    await User.create({
      name: 'Super Admin',
      email: 'admin@shantikunj.com',
      password: hashedPassword,
      role: 'admin',
      status: 'approved',
      isActive: true
    })

    console.log('✅ Admin created successfully!')
    console.log('Email: admin@shantikunj.com')
    console.log('Password: Admin@2026')
    process.exit()

  } catch (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }
}

createAdmin()


// {
//   "message": "Login successful",
//   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWM4ZDYxYzMyMGQwN2FjNzcyMDU5YjUiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzQ3Njk4MDUsImV4cCI6MTc3NTM3NDYwNX0.bujeSQjMjplPlmnAEKoGy8-CkZ9SyZ4j6xoLH7gjAFI",
//   "user": {
//     "id": "69c8d61c320d07ac772059b5",
//     "name": "Super Admin",
//     "email": "admin@shantikunj.com",
//     "role": "admin",
//     "language": null
//   }
// }
const { v2: cloudinary } = require('cloudinary')
const fs = require('fs/promises')

const isCloudinaryConfigured = () => {
    const hasUrl = Boolean(process.env.CLOUDINARY_URL)
    const hasSplitCredentials = Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    )

    return hasUrl || hasSplitCredentials
}

if (isCloudinaryConfigured()) {
    if (process.env.CLOUDINARY_URL) {
        cloudinary.config({
            cloudinary_url: process.env.CLOUDINARY_URL
        })
    } else {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        })
    }
}

const uploadFileToCloudinary = async ({ filePath, folder, resourceType = 'auto' }) => {
    if (!isCloudinaryConfigured()) {
        throw new Error('Cloudinary is not configured')
    }

    return cloudinary.uploader.upload(filePath, {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        overwrite: false
    })
}

const removeLocalFile = async (filePath) => {
    if (!filePath) return

    try {
        await fs.unlink(filePath)
    } catch (_error) {
        // Ignore cleanup errors to avoid breaking uploads.
    }
}

module.exports = {
    isCloudinaryConfigured,
    uploadFileToCloudinary,
    removeLocalFile
}

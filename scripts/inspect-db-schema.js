const dotenv = require('dotenv')
const mongoose = require('mongoose')

dotenv.config()

function getType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (value && value._bsontype) {
    const t = String(value._bsontype).toLowerCase()
    if (t.includes('objectid')) return 'objectId'
    return t
  }
  return typeof value
}

function mergeShape(target, source) {
  Object.entries(source).forEach(([key, value]) => {
    if (!target[key]) {
      target[key] = {
        types: new Set(),
        children: null,
        arrayElementTypes: new Set(),
        arrayChildren: null
      }
    }

    const entry = target[key]
    const valueType = getType(value)
    entry.types.add(valueType)

    if (valueType === 'object' && value) {
      if (!entry.children) entry.children = {}
      mergeShape(entry.children, value)
    }

    if (valueType === 'array') {
      value.forEach((el) => {
        const elType = getType(el)
        entry.arrayElementTypes.add(elType)
        if (elType === 'object' && el) {
          if (!entry.arrayChildren) entry.arrayChildren = {}
          mergeShape(entry.arrayChildren, el)
        }
      })
    }
  })
}

function serializeShape(shape) {
  const output = {}
  Object.entries(shape).forEach(([key, meta]) => {
    const item = {
      types: [...meta.types].sort()
    }

    if (meta.arrayElementTypes.size > 0) {
      item.arrayElementTypes = [...meta.arrayElementTypes].sort()
    }
    if (meta.children) item.children = serializeShape(meta.children)
    if (meta.arrayChildren) item.arrayChildren = serializeShape(meta.arrayChildren)

    output[key] = item
  })

  return output
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(process.env.MONGO_URI)
  const db = mongoose.connection.db

  const collections = await db.listCollections({}, { nameOnly: true }).toArray()
  const result = {
    databaseName: db.databaseName,
    collectionCount: collections.length,
    collections: {}
  }

  for (const { name } of collections) {
    const collection = db.collection(name)
    const totalDocs = await collection.estimatedDocumentCount()
    const sampleSize = totalDocs > 0 ? Math.min(25, totalDocs) : 0

    let docs = []
    if (sampleSize > 0) {
      try {
        docs = await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray()
      } catch (_error) {
        docs = await collection.find({}).limit(sampleSize).toArray()
      }
    }

    const shape = {}
    docs.forEach((doc) => mergeShape(shape, doc))

    result.collections[name] = {
      estimatedDocumentCount: totalDocs,
      sampledDocuments: docs.length,
      inferredSchema: serializeShape(shape)
    }
  }

  console.log(JSON.stringify(result, null, 2))
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error('SCHEMA_INSPECT_ERROR:', error.message)
  try {
    await mongoose.disconnect()
  } catch (_error) {
    // ignore
  }
  process.exit(1)
})

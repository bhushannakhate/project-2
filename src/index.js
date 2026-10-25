import process from 'node:process'
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import { validateCustomer } from './customerSchema.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const mongodbUri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DATABASE || 'project2'
const allowedOrigins = (process.env.WEB_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean)

app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('This website origin is not allowed by the API.'))
} }))
app.use(express.json({ limit: '20kb' }))

if (!mongodbUri) {
  throw new Error('Set MONGODB_URI to connect to the MongoDB database.')
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

function mongoId(id) {
  return /^[\da-f]{24}$/i.test(id) ? new ObjectId(id) : id
}

function toApiCustomer({ _id, ...customer }) {
  return { id: _id.toString(), ...customer }
}

async function start() {
  const client = new MongoClient(mongodbUri)
  let customers
  try {
    await client.connect()
    customers = client.db(databaseName).collection('customers')
    await customers.createIndex({ email: 1 }, { unique: true })
  } catch (error) {
    await client.close()
    throw error
  }

  app.get('/api/customers', async (request, response, next) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 10, 1), 10)
      const records = await customers.find().sort({ createdAt: -1 }).limit(limit).toArray()
      const mappedRecords = records.map(toApiCustomer)
      response.json({ customers: mappedRecords, count: mappedRecords.length })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/customers', async (request, response, next) => {
    const { customer, error } = validateCustomer(request.body)
    if (error) return response.status(400).json({ error })

    try {
      const record = { ...customer, createdAt: new Date() }
      const result = await customers.insertOne(record)
      response.status(201).json({ customer: toApiCustomer({ _id: result.insertedId, ...record }) })
    } catch (requestError) {
      next(requestError)
    }
  })

  app.patch('/api/customers/:id', async (request, response, next) => {
    const { id } = request.params
    if (!id || id.includes('/')) {
      return response.status(400).json({ error: 'Provide a valid customer document ID.' })
    }

    const { customer: updatedCustomer, error } = validateCustomer(request.body)
    if (error) return response.status(400).json({ error })

    try {
      const saved = await customers.findOneAndUpdate(
        { _id: mongoId(id) },
        { $set: { ...updatedCustomer, updatedAt: new Date() } },
        { returnDocument: 'after' },
      )
      if (!saved) return response.status(404).json({ error: 'Customer not found.' })
      response.json({ customer: toApiCustomer(saved) })
    } catch (updateError) {
      next(updateError)
    }
  })

  app.delete('/api/customers/:id', async (request, response, next) => {
    const { id } = request.params
    if (!id || id.includes('/')) {
      return response.status(400).json({ error: 'Provide a valid customer document ID.' })
    }

    try {
      const result = await customers.deleteOne({ _id: mongoId(id) })
      if (!result.deletedCount) {
        return response.status(404).json({ error: 'Customer not found.' })
      }
      response.json({ message: 'Customer deleted.', id })
    } catch (error) {
      next(error)
    }
  })

  app.use((error, _request, response, _next) => {
    if (error.code === 11000) {
      return response.status(409).json({ error: 'A customer with this email already exists.' })
    }
    console.error('Customer API error:', error.message)
    response.status(500).json({ error: 'The customer database request failed. Check MongoDB configuration and connectivity.' })
  })

  app.listen(port, () => console.log(`Customer API listening on port ${port}`))
}

start().catch(() => {
  console.error('Unable to start the customer API. Check MONGODB_URI, database access, and network allowlist settings.')
  process.exitCode = 1
})

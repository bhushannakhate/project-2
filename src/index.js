import process from 'node:process'
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { validateCustomer } from './customerSchema.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const projectId = process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
const allowedOrigins = (process.env.WEB_ORIGIN || 'http://localhost:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean)

app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('This website origin is not allowed by the API.'))
} }))
app.use(express.json({ limit: '20kb' }))

if (!projectId) {
  throw new Error('Set FIRESTORE_PROJECT_ID to the Google Cloud project that owns the Firestore database.')
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId })
}

const customers = getFirestore().collection('customers')

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

app.get('/api/customers', async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 10, 1), 10)
    const snapshot = await customers.orderBy('createdAt', 'desc').limit(limit).get()
    const records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
    response.json({ customers: records, count: records.length })
  } catch (error) {
    next(error)
  }
})

app.post('/api/customers', async (request, response, next) => {
  const { customer, error } = validateCustomer(request.body)
  if (error) return response.status(400).json({ error })

  try {
    const existingEmail = await customers.where('email', '==', customer.email).limit(1).get()
    if (!existingEmail.empty) return response.status(409).json({ error: 'A customer with this email already exists.' })

    const record = { ...customer, createdAt: FieldValue.serverTimestamp() }
    const document = await customers.add(record)
    const saved = await document.get()
    response.status(201).json({ customer: { id: document.id, ...saved.data() } })
  } catch (requestError) {
    next(requestError)
  }
})

app.use((error, _request, response, _next) => {
  void _next
  console.error('Customer API error:', error.message)
  response.status(500).json({ error: 'The customer database request failed. Check API configuration and Firestore permissions.' })
})

app.listen(port, () => console.log(`Customer API listening on port ${port}`))

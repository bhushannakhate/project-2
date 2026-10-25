import 'dotenv/config'
import process from 'node:process'
import { MongoClient } from 'mongodb'

const mongodbUri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DATABASE || 'project2'
if (!mongodbUri) throw new Error('Set MONGODB_URI before creating demo records.')

const sampleCustomers = [
  ['Avery Morgan', 'avery.morgan@example.test', 'averym', 'Art & illustration', ['watercolor', 'printmaking']],
  ['Jordan Lee', 'jordan.lee@example.test', 'jordancreates', 'Home & interiors', ['plants', 'interiors']],
  ['Taylor Rivera', 'taylor.rivera@example.test', 'taylorr', 'Fashion & style', ['sustainable fashion', 'color']],
  ['Casey Patel', 'casey.patel@example.test', 'caseypatel', 'Food & recipes', ['baking', 'vegetarian']],
  ['Morgan Chen', 'morgan.chen@example.test', 'morganchen', 'Travel', ['hiking', 'photography']],
  ['Riley Thompson', 'riley.thompson@example.test', 'rileyt', 'DIY & crafts', ['ceramics', 'DIY']],
  ['Quinn Brooks', 'quinn.brooks@example.test', 'quinnb', 'Art & illustration', ['digital art', 'design']],
  ['Jamie Kim', 'jamie.kim@example.test', 'jamiekim', 'Home & interiors', ['small spaces', 'gardens']],
  ['Alexis Garcia', 'alexis.garcia@example.test', 'alexisg', 'Fashion & style', ['vintage', 'styling']],
  ['Sam Wilson', 'sam.wilson@example.test', 'samwilson', 'Travel', ['city guides', 'architecture']],
]

const client = new MongoClient(mongodbUri)
try {
  await client.connect()
  const customers = client.db(databaseName).collection('customers')
  await customers.createIndex({ email: 1 }, { unique: true })

  for (const [index, [fullName, email, username, preferredCategory, interests]] of sampleCustomers.entries()) {
    const id = `demo-${String(index + 1).padStart(3, '0')}`
    await customers.updateOne(
      { _id: id },
      {
        $set: {
          fullName,
          email,
          username,
          phone: '',
          bio: 'Fictional sample profile for the Project 2 MongoDB demonstration.',
          interests,
          preferredCategory,
          marketingOptIn: false,
          demoRecord: true,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    )
  }
  console.log(`Created or refreshed ${sampleCustomers.length} fictional demo records in the customers collection.`)
} finally {
  await client.close()
}

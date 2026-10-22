import 'dotenv/config'
import process from 'node:process'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const projectId = process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
if (!projectId) throw new Error('Set FIRESTORE_PROJECT_ID before creating demo records.')
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId })

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

const db = getFirestore()
const batch = db.batch()
for (const [index, [fullName, email, username, preferredCategory, interests]] of sampleCustomers.entries()) {
  const reference = db.collection('customers').doc(`demo-${String(index + 1).padStart(3, '0')}`)
  batch.set(reference, {
    fullName,
    email,
    username,
    phone: '',
    bio: 'Fictional sample profile for the Project 2 Firestore demonstration.',
    interests,
    preferredCategory,
    marketingOptIn: false,
    createdAt: FieldValue.serverTimestamp(),
    demoRecord: true,
  }, { merge: true })
}

await batch.commit()
console.log('Created or refreshed 10 fictional demo records in the customers collection.')

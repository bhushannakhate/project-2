const MAX_LENGTHS = {
  fullName: 100,
  email: 254,
  username: 30,
  phone: 30,
  bio: 500,
  preferredCategory: 80,
}

const OPTIONAL_TEXT_FIELDS = ['phone', 'bio', 'preferredCategory']

export function validateCustomer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Provide customer details as a JSON object.' }
  }

  const customer = {}
  for (const field of ['fullName', 'email', 'username']) {
    const value = input[field]
    if (typeof value !== 'string' || !value.trim()) {
      return { error: `${field} is required.` }
    }
    if (value.trim().length > MAX_LENGTHS[field]) {
      return { error: `${field} must be ${MAX_LENGTHS[field]} characters or fewer.` }
    }
    customer[field] = value.trim()
  }

  customer.email = customer.email.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    return { error: 'Provide a valid email address.' }
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(customer.username)) {
    return { error: 'Username can contain letters, numbers, dots, underscores, and hyphens.' }
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = input[field] ?? ''
    if (typeof value !== 'string' || value.trim().length > MAX_LENGTHS[field]) {
      return { error: `${field} must be text with at most ${MAX_LENGTHS[field]} characters.` }
    }
    customer[field] = value.trim() || (field === 'preferredCategory' ? 'General inspiration' : '')
  }

  if (input.interests !== undefined && (!Array.isArray(input.interests) || input.interests.length > 20)) {
    return { error: 'Interests must be a list containing no more than 20 items.' }
  }
  customer.interests = (input.interests ?? []).map((interest) => String(interest).trim()).filter(Boolean).slice(0, 20)
  if (customer.interests.some((interest) => interest.length > 50)) {
    return { error: 'Each interest must be 50 characters or fewer.' }
  }
  if (input.marketingOptIn !== undefined && typeof input.marketingOptIn !== 'boolean') {
    return { error: 'marketingOptIn must be true or false.' }
  }
  customer.marketingOptIn = input.marketingOptIn ?? false

  return { customer }
}

import { mongoId, toApiCustomer } from "../models/customerModel.js";

export async function listCustomers(collection, limit) {
  const records = await collection
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  const customers = records.map(toApiCustomer);
  return { customers, count: customers.length };
}

export async function createCustomer(collection, customer) {
  const record = { ...customer, createdAt: new Date() };
  const result = await collection.insertOne(record);
  return toApiCustomer({ _id: result.insertedId, ...record });
}

export async function updateCustomer(collection, id, customer) {
  const saved = await collection.findOneAndUpdate(
    { _id: mongoId(id) },
    { $set: { ...customer, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return saved ? toApiCustomer(saved) : null;
}

export async function deleteCustomer(collection, id) {
  const result = await collection.deleteOne({ _id: mongoId(id) });
  return result.deletedCount > 0;
}

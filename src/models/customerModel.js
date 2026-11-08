import { ObjectId } from "mongodb";

function mongoId(id) {
  return /^[\da-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}

function toApiCustomer({ _id, ...customer }) {
  return { id: _id.toString(), ...customer };
}

export function createCustomerModel(collection) {
  return {
    async ensureIndexes() {
      await collection.createIndex({ email: 1 }, { unique: true });
    },
    async list(limit) {
      const records = await collection
        .find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return records.map(toApiCustomer);
    },
    async create(customer) {
      const record = { ...customer, createdAt: new Date() };
      const result = await collection.insertOne(record);
      return toApiCustomer({ _id: result.insertedId, ...record });
    },
    async update(id, customer) {
      const record = await collection.findOneAndUpdate(
        { _id: mongoId(id) },
        { $set: { ...customer, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      return record ? toApiCustomer(record) : null;
    },
    async delete(id) {
      const result = await collection.deleteOne({ _id: mongoId(id) });
      return result.deletedCount > 0;
    },
  };
}

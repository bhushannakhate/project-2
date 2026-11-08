import { ObjectId } from "mongodb";

export function mongoId(id) {
  return /^[\da-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}

export function toApiCustomer({ _id, ...customer }) {
  return { id: _id.toString(), ...customer };
}

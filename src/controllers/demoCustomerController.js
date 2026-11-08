import { ApiError } from "../middleware/errorHandler.js";
import {
  createCustomer,
  deleteCustomer,
  listCustomers,
  updateCustomer,
} from "../services/customerService.js";

export function createDemoCustomerController(collection) {
  return {
    list: async (request, response) => {
      const requestedLimit = Number.parseInt(request.query.limit, 10) || 10;
      const result = await listCustomers(
        collection,
        Math.min(Math.max(requestedLimit, 1), 10),
      );
      response.json(result);
    },

    create: async (request, response) => {
      const customer = await createCustomer(collection, request.customer);
      response.status(201).json({ customer });
    },

    update: async (request, response) => {
      const customer = await updateCustomer(
        collection,
        request.params.id,
        request.customer,
      );
      if (!customer) {
        throw new ApiError(404, "NOT_FOUND", "Customer not found.");
      }
      response.json({ customer });
    },

    remove: async (request, response) => {
      const { id } = request.params;
      if (!id || id.includes("/")) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Provide a valid customer document ID.",
        );
      }
      if (!(await deleteCustomer(collection, id))) {
        throw new ApiError(404, "NOT_FOUND", "Customer not found.");
      }
      response.json({ message: "Customer deleted.", id });
    },
  };
}

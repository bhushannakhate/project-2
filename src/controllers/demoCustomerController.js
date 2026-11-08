export function createDemoCustomerController(customerService) {
  return {
    async list(request, response) {
      const parsedLimit = Number.parseInt(request.query.limit, 10);
      const limit = Math.min(Math.max(parsedLimit || 10, 1), 10);
      const customers = await customerService.list(limit);
      response.json({ customers, count: customers.length });
    },
    async create(request, response) {
      const customer = await customerService.create(request.validatedBody);
      response.status(201).json({ customer });
    },
    async update(request, response) {
      const { id } = request.params;
      if (id.includes("/")) {
        response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide a valid customer document ID.",
          },
        });
        return;
      }

      const customer = await customerService.update(id, request.validatedBody);
      if (!customer) {
        response.status(404).json({
          error: { code: "NOT_FOUND", message: "Customer not found." },
        });
        return;
      }
      response.json({ customer });
    },
    async delete(request, response) {
      const { id } = request.params;
      if (id.includes("/")) {
        response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide a valid customer document ID.",
          },
        });
        return;
      }

      if (!(await customerService.delete(id))) {
        response.status(404).json({
          error: { code: "NOT_FOUND", message: "Customer not found." },
        });
        return;
      }
      response.json({ message: "Customer deleted.", id });
    },
  };
}

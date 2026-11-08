import { Router } from "express";
import { createDemoCustomerController } from "../controllers/demoCustomerController.js";
import { validateBody } from "../middleware/validateBody.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateCustomer } from "../models/customerValidation.js";

export function createDemoCustomerRoutes(customerService) {
  const router = Router();
  const controller = createDemoCustomerController(customerService);

  router.get("/", asyncHandler(controller.list));
  router.post(
    "/",
    validateBody(validateCustomer),
    asyncHandler(controller.create),
  );
  router.patch(
    "/:id",
    validateBody(validateCustomer),
    asyncHandler(controller.update),
  );
  router.delete("/:id", asyncHandler(controller.delete));

  return router;
}

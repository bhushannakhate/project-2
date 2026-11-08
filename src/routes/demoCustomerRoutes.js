import { Router } from "express";
import { createDemoCustomerController } from "../controllers/demoCustomerController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody } from "../middleware/validateBody.js";
import { validateCustomer } from "../middleware/validateCustomer.js";

export function createDemoCustomerRoutes(collection) {
  const router = Router();
  const controller = createDemoCustomerController(collection);

  router.get("/", asyncHandler(controller.list));
  router.post(
    "/",
    validateBody,
    validateCustomer,
    asyncHandler(controller.create),
  );
  router.patch(
    "/:id",
    validateBody,
    validateCustomer,
    asyncHandler(controller.update),
  );
  router.delete("/:id", asyncHandler(controller.remove));

  return router;
}

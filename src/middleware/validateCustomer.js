import { validateCustomer as parseCustomer } from "../models/customerValidation.js";
import { ApiError } from "./errorHandler.js";

export function validateCustomer(request, _response, next) {
  const result = parseCustomer(request.body);
  if (result.error) {
    next(new ApiError(400, "VALIDATION_ERROR", result.error));
    return;
  }

  request.customer = result.customer;
  next();
}

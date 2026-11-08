export function validateBody(validator) {
  return function validateRequestBody(request, response, next) {
    const result = validator(request.body);
    if (result.error) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: result.error,
        },
      });
      return;
    }

    request.validatedBody = result.customer;
    next();
  };
}

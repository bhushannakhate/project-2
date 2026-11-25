import { randomUUID } from "node:crypto";

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function requestId(request, response, next) {
  const incoming = request.get("x-request-id");
  const id = incoming && UUID_PATTERN.test(incoming) ? incoming : randomUUID();
  request.requestId = id;
  response.setHeader("X-Request-Id", id);
  next();
}

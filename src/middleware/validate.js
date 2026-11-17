export function validate(schema) {
  return function validateRequest(req, _res, next) {
    req.validated = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    next();
  };
}

function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Express 5 forwards rejected promises from async route handlers here
// automatically, so controllers don't need a try/catch wrapper.
function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === "ValidationError") {
    return res.status(400).json({ message: Object.values(err.errors)[0]?.message || "Validation failed" });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid id format" });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: "That value is already in use" });
  }

  const status = err.status || 500;
  res.status(status).json({ message: err.message || "Something went wrong" });
}

module.exports = { notFound, errorHandler };

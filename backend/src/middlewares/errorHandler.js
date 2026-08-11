// Naming the method and path distinguishes "this route does not exist" from a
// handler that looked something up and did not find it — both surface as 404
// and are otherwise indistinguishable from the client side.
const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}`, routeNotFound: true });
};

const errorHandler = (err, req, res, next) => {
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ message: `${field} already exists` });
  }
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return res.status(400).json({ message });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid identifier' });
  }
  const status = err.status || 500;
  if (status >= 500) {
    console.error('Unhandled error:', err.message);
  }
  const payload = { message: err.message || 'Server error' };
  // An unexpected 4xx is far easier to trace with the error's class name than
  // with its message alone. Withheld in production so internals are not exposed.
  if (process.env.NODE_ENV !== 'production' && err.name && err.name !== 'Error') {
    payload.error = err.name;
  }
  res.status(status).json(payload);
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };

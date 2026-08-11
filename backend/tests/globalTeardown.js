module.exports = async () => {
  const server = globalThis.__MONGO_SERVER__;
  if (server) await server.stop();
};

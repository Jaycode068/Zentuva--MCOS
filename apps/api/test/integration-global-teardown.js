// Jest `globalTeardown` for jest.integration.config.js. Intentionally minimal — each test
// file's own PrismaClient disconnects itself in its own afterAll; this just gives a single
// place to add cross-run teardown later if ever needed.
module.exports = async function globalTeardown() {};

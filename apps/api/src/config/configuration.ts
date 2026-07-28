export default () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
});

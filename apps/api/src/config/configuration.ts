export default () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  auth: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
  },
  uploads: {
    dir: process.env.UPLOAD_DIR ?? 'uploads',
    publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    maxFileSizeBytes: parseInt(
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? String(2 * 1024 * 1024),
      10,
    ),
  },
});

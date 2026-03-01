export interface AppConfig {
  NODE_ENV: string;
  PORT: number;
  WORKER_PORT: number;

  APP_ORIGIN: string;
  CORS_ORIGINS: string[];
  TRUST_PROXY: number;

  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_MIGRATIONS_USER: string;
  DB_MIGRATIONS_PASSWORD: string;

  JWT_SECRET: string;

  STAFF_COOKIE_NAME: string;
  CUSTOMER_COOKIE_NAME: string;
  SUPER_COOKIE_NAME: string;

  SUPER_ADMIN_EMAIL: string;
  SUPER_ADMIN_PASSWORD: string;
  SUPER_ADMIN_PASSWORD_HASH: string;
  SIGNUP_CAPTCHA_SECRET: string;

  QR_PRIVATE_KEY_PEM: string;
  QR_PUBLIC_KEY_PEM: string;

  MESSAGE_PROVIDER: string;
  WA_PHONE_NUMBER_ID: string;
  WA_ACCESS_TOKEN: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  SMS_GATEWAY_URL: string;
  SMS_GATEWAY_TOKEN: string;

  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_DRIVER: string;
  REDIS_URL: string;
  JOB_QUEUE_DRIVER: string;

  CHURN_DAYS: number;
  CHURN_SEND_HOUR_LOCAL: number;
  CRON_TZ: string;

  WEBHOOK_TIMEOUT_MS: number;
  WEBHOOK_CONCURRENCY: number;
  WEBHOOK_MAX_ATTEMPTS: number;
  WEBHOOK_REQUIRE_HTTPS: boolean;
  WEBHOOK_ALLOWLIST: string[];
  WEBHOOK_SECRET_ENC_KEY: string;
  WEBHOOK_SECRET_ENC_KEY_PREVIOUS: string[];
  PAYMENT_WEBHOOK_SECRETS: Record<string, unknown>;
  PAYMENT_WEBHOOK_HMAC_SECRETS: Record<string, unknown>;
  PAYMENT_WEBHOOK_ALLOWED_PROVIDERS: string[];
  PAYMENT_WEBHOOK_REQUIRE_AUTH: boolean;
  METRICS_TOKEN: string;
  EXTERNAL_AWARD_API_KEY: string;
  REGISTRATION_API_KEY: string;

  JOB_WORKER_INTERVAL_MS: number;
  JOB_WORKER_BATCH_SIZE: number;

  DEFAULT_PLAN: string;
  ENFORCE_TENANT_CONTEXT: boolean;
  AUTO_APPLY_SCHEMA_EXTENSIONS: boolean;
  AUTO_APPLY_MIGRATIONS: boolean;
}

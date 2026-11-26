import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.number().int().min(1).max(65535),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "Must be a MongoDB connection string."),
    CLIENT_ORIGIN: z.string().url(),
    APP_BASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SESSION_SECRET: z.string().min(16),
    CSRF_SECRET: z.string().min(16),
    SENTRY_DSN: z.string().min(1).optional(),
    EMAIL_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    EMAIL_SMTP_HOST: z.string().min(1).optional(),
    EMAIL_SMTP_PORT: z.number().int().min(1).max(65535).default(587),
    EMAIL_SMTP_USER: z.string().min(1).optional(),
    EMAIL_SMTP_PASS: z.string().min(1).optional(),
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    BOOTSTRAP_ADMIN_NAME: z.string().min(1).optional(),
    STORAGE_DRIVER: z.enum(["s3", "cloudinary"]).optional(),
    STORAGE_BUCKET: z.string().min(1).optional(),
    STORAGE_REGION: z.string().min(1).optional(),
    STORAGE_KEY: z.string().min(1).optional(),
    STORAGE_SECRET: z.string().min(1).optional(),
    STORAGE_ENDPOINT: z.string().url().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === "s3") {
      for (const key of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_KEY", "STORAGE_SECRET"] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when STORAGE_DRIVER is s3." });
        }
      }
    }
    if (value.STORAGE_DRIVER === "cloudinary") {
      for (const key of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "Required when STORAGE_DRIVER is cloudinary.",
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 4000;
  }
  const port = Number(value);
  return Number.isInteger(port) ? port : Number.NaN;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = source.NODE_ENV ?? "development";
  const parsed = envSchema.safeParse({
    NODE_ENV: nodeEnv,
    PORT: parsePort(source.PORT),
    MONGODB_URI: source.MONGODB_URI,
    CLIENT_ORIGIN:
      emptyToUndefined(source.CLIENT_ORIGIN) ?? (nodeEnv === "production" ? undefined : "http://localhost:5173"),
    APP_BASE_URL:
      emptyToUndefined(source.APP_BASE_URL) ??
      (nodeEnv === "production" ? undefined : emptyToUndefined(source.CLIENT_ORIGIN) ?? "http://localhost:5173"),
    LOG_LEVEL: emptyToUndefined(source.LOG_LEVEL),
    SESSION_SECRET: emptyToUndefined(source.SESSION_SECRET),
    CSRF_SECRET: emptyToUndefined(source.CSRF_SECRET),
    SENTRY_DSN: emptyToUndefined(source.SENTRY_DSN),
    EMAIL_API_KEY: emptyToUndefined(source.EMAIL_API_KEY),
    EMAIL_FROM: emptyToUndefined(source.EMAIL_FROM),
    EMAIL_SMTP_HOST: emptyToUndefined(source.EMAIL_SMTP_HOST),
    EMAIL_SMTP_PORT: emptyToUndefined(source.EMAIL_SMTP_PORT) ? parsePort(source.EMAIL_SMTP_PORT) : 587,
    EMAIL_SMTP_USER: emptyToUndefined(source.EMAIL_SMTP_USER),
    EMAIL_SMTP_PASS: emptyToUndefined(source.EMAIL_SMTP_PASS),
    BOOTSTRAP_ADMIN_EMAIL: emptyToUndefined(source.BOOTSTRAP_ADMIN_EMAIL),
    BOOTSTRAP_ADMIN_NAME: emptyToUndefined(source.BOOTSTRAP_ADMIN_NAME),
    STORAGE_DRIVER: emptyToUndefined(source.STORAGE_DRIVER),
    STORAGE_BUCKET: emptyToUndefined(source.STORAGE_BUCKET),
    STORAGE_REGION: emptyToUndefined(source.STORAGE_REGION),
    STORAGE_KEY: emptyToUndefined(source.STORAGE_KEY),
    STORAGE_SECRET: emptyToUndefined(source.STORAGE_SECRET),
    STORAGE_ENDPOINT: emptyToUndefined(source.STORAGE_ENDPOINT),
    CLOUDINARY_CLOUD_NAME: emptyToUndefined(source.CLOUDINARY_CLOUD_NAME),
    CLOUDINARY_API_KEY: emptyToUndefined(source.CLOUDINARY_API_KEY),
    CLOUDINARY_API_SECRET: emptyToUndefined(source.CLOUDINARY_API_SECRET),
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

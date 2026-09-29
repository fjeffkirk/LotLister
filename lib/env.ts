import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  /** Legacy: per-store custom app. OAuth stores token in AppSetting instead. */
  SHOPIFY_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2024-10"),
  /** Partner / public app — used with SHOPIFY_CLIENT_SECRET for OAuth. */
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  /** Comma-separated. Defaults in lib/shopify/oauth if unset. */
  SHOPIFY_SCOPES: z.string().optional(),
  /** Base URL, no trailing slash. Example: http://localhost:3000 or https://yourdomain.com */
  SHOPIFY_APP_URL: z.string().optional(),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  CRON_SECRET: z.string().optional(),
  /** When set, a login cookie is required to use the app. */
  APP_PASSWORD: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  /** Env-only token + domain (not DB OAuth). */
  hasDirectShopifyEnv: boolean;
  databaseConfigured: boolean;
};

function loadEnv(): AppEnv {
  const raw = {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
    SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES,
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    DEMO_MODE: process.env.DEMO_MODE,
    CRON_SECRET: process.env.CRON_SECRET,
    APP_PASSWORD: process.env.APP_PASSWORD,
  };
  const parsed = envSchema.safeParse(raw);
  const base = parsed.success
    ? parsed.data
    : {
        NODE_ENV: "development" as const,
        DATABASE_URL: undefined,
        SHOPIFY_SHOP_DOMAIN: undefined,
        SHOPIFY_ACCESS_TOKEN: undefined,
        SHOPIFY_API_VERSION: "2024-10",
        SHOPIFY_CLIENT_ID: undefined,
        SHOPIFY_CLIENT_SECRET: undefined,
        SHOPIFY_SCOPES: undefined,
        SHOPIFY_APP_URL: undefined,
        DEMO_MODE: false,
        CRON_SECRET: undefined,
        APP_PASSWORD: undefined,
      };

  const hasDirectShopifyEnv = Boolean(
    base.SHOPIFY_SHOP_DOMAIN &&
      base.SHOPIFY_ACCESS_TOKEN &&
      base.SHOPIFY_SHOP_DOMAIN.length > 0 &&
      base.SHOPIFY_ACCESS_TOKEN.length > 0
  );
  const databaseConfigured = Boolean(base.DATABASE_URL && base.DATABASE_URL.length > 0);

  return { ...base, hasDirectShopifyEnv, databaseConfigured };
}

export const env = loadEnv();

/** @deprecated use `isDemoModeAsync` from `@/lib/shopify/config` (includes OAuth tokens in DB) */
export function isDemoMode(): boolean {
  return env.DEMO_MODE === true;
}

/**
 * @mountain/config — environment parsing and platform configuration.
 * Pricing and plans stay configurable (spec section 12) — never hardcoded in app logic.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  mongoUri: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  aiServiceUrl: string;
}

export function loadConfig(): AppConfig {
  const env = optional('NODE_ENV', 'development');
  if (env !== 'development' && env !== 'test' && env !== 'production') {
    throw new Error(`Invalid NODE_ENV: ${env}`);
  }
  return {
    env,
    port: Number(optional('PORT', '4000')),
    mongoUri: optional('MONGO_URI', 'mongodb://localhost:27017/mountain'),
    redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
    jwt: {
      accessSecret: required('JWT_ACCESS_SECRET'),
      refreshSecret: required('JWT_REFRESH_SECRET'),
      accessTtlSeconds: Number(optional('JWT_ACCESS_TTL', '900')),
      refreshTtlSeconds: Number(optional('JWT_REFRESH_TTL', '604800')),
    },
    aiServiceUrl: optional('AI_SERVICE_URL', 'http://localhost:8000'),
  };
}

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  transactionFeePercent: number;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'FREE',
    name: 'Free',
    monthlyPrice: 0,
    currency: 'USD',
    transactionFeePercent: 2,
    features: ['1 store', 'Basic analytics', 'Community support'],
  },
  {
    id: 'STARTER',
    name: 'Starter',
    monthlyPrice: 19,
    currency: 'USD',
    transactionFeePercent: 1.5,
    features: ['Custom domain', 'Discounts', 'Email support'],
  },
  {
    id: 'PRO',
    name: 'Pro',
    monthlyPrice: 49,
    currency: 'USD',
    transactionFeePercent: 1,
    features: ['Page builder', 'Abandoned cart', 'Priority support'],
  },
  {
    id: 'BUSINESS',
    name: 'Business',
    monthlyPrice: 99,
    currency: 'USD',
    transactionFeePercent: 0.5,
    features: ['Multi-warehouse', 'Advanced analytics', 'API access'],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    monthlyPrice: -1,
    currency: 'USD',
    transactionFeePercent: 0,
    features: ['Dedicated infrastructure', 'SLA', 'Custom AI limits'],
  },
];

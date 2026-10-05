import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedis } from './redis.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'live' });
});

healthRouter.get('/ready', async (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  let redisReady = false;
  try {
    const redis = getRedis();
    redisReady = (await redis.ping()) === 'PONG';
  } catch {
    redisReady = false;
  }

  const status = mongoReady && redisReady ? 200 : 503;
  res.status(status).json({
    status: mongoReady && redisReady ? 'ready' : 'degraded',
    mongo: mongoReady ? 'up' : 'down',
    redis: redisReady ? 'up' : 'down',
  });
});

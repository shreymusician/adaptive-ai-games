import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import connectDB from './db/connection';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import memoryRoutes from './routes/memory';
import matchRoutes from './routes/match';
import { initAIStack } from './ai/bootstrap';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json());

connectDB().then(async () => {
  app.use('/api', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api', memoryRoutes);
  app.use('/api', matchRoutes);

  // Adaptive AI Engine: Event Pipeline ingestion (POST /api/events/batch,
  // etc. — auto-orchestrated, see @adaptive-ai/orchestration) and the
  // read-only dashboard API (GET /api/dashboard/...). Mounted only after
  // the stack finishes creating its indexes, so no request can race
  // index creation.
  const aiStack = await initAIStack();
  app.use('/api', aiStack.eventRouter);
  app.use('/api', aiStack.dashboardRouter);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});

export default app;

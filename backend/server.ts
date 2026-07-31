import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './db/connection';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import memoryRoutes from './routes/memory';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json());

connectDB().then(() => {
  app.use('/api', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api', memoryRoutes);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});

export default app;

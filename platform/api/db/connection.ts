import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || '';

    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    await mongoose.connect(mongoURI, {
      dbName: process.env.MONGODB_DB_NAME || 'adaptive-games',
    });

    console.log('MongoDB connected successfully');
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;

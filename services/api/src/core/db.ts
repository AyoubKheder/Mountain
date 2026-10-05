import mongoose from 'mongoose';

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: 2500,
  });
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}


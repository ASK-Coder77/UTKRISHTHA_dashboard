import mongoose from "mongoose";

type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = globalThis as typeof globalThis & { mongooseCache?: MongooseCache };
const cache = (globalWithMongoose.mongooseCache ??= { conn: null, promise: null });

export async function connectToDatabase() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  cache.promise ??= mongoose.connect(uri);
  cache.conn = await cache.promise;
  return cache.conn;
}

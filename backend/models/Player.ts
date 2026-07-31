import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayer extends Document {
  sessionId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlayerSchema = new Schema<IPlayer>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IPlayer>('Player', PlayerSchema);

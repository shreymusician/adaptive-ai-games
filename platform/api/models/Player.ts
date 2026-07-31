import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayer extends Document {
  email: string;
  name: string;
  passwordHash?: string;
  googleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlayerSchema = new Schema<IPlayer>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    passwordHash: {
      type: String,
      required: false,
    },
    googleId: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IPlayer>('Player', PlayerSchema);

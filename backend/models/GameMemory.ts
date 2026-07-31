import mongoose, { Schema, Document } from 'mongoose';

export type GameType = 'warden' | 'five';

export interface IGameMemory extends Document {
  playerId: mongoose.Types.ObjectId;
  gameType: GameType;
  data: Record<string, any>;
  updatedAt: Date;
  createdAt: Date;
}

const GameMemorySchema = new Schema<IGameMemory>(
  {
    playerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
      index: true,
    },
    gameType: {
      type: String,
      enum: ['warden', 'five'],
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

GameMemorySchema.index({ playerId: 1, gameType: 1 }, { unique: true });

export default mongoose.model<IGameMemory>('GameMemory', GameMemorySchema);

import mongoose, { Schema, Document } from 'mongoose';
import { GameType } from './GameMemory';

export interface IGameSession extends Document {
  playerId: mongoose.Types.ObjectId;
  gameType: GameType;
  matchNumber: number;
  won: boolean;
  duration: number;
  timestamp: Date;
}

const GameSessionSchema = new Schema<IGameSession>(
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
    matchNumber: {
      type: Number,
      required: true,
    },
    won: {
      type: Boolean,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: false,
  }
);

GameSessionSchema.index({ playerId: 1, gameType: 1 });

export default mongoose.model<IGameSession>('GameSession', GameSessionSchema);

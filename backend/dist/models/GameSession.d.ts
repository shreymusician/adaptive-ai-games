import mongoose, { Document } from 'mongoose';
import { GameType } from './GameMemory';
export interface IGameSession extends Document {
    playerId: mongoose.Types.ObjectId;
    gameType: GameType;
    matchNumber: number;
    won: boolean;
    duration: number;
    timestamp: Date;
}
declare const _default: mongoose.Model<IGameSession, {}, {}, {}, Document<unknown, {}, IGameSession, {}, mongoose.DefaultSchemaOptions> & IGameSession & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IGameSession>;
export default _default;
//# sourceMappingURL=GameSession.d.ts.map
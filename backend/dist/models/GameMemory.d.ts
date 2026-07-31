import mongoose, { Document } from 'mongoose';
export type GameType = 'warden' | 'five';
export interface IGameMemory extends Document {
    playerId: mongoose.Types.ObjectId;
    gameType: GameType;
    data: Record<string, any>;
    updatedAt: Date;
    createdAt: Date;
}
declare const _default: mongoose.Model<IGameMemory, {}, {}, {}, Document<unknown, {}, IGameMemory, {}, mongoose.DefaultSchemaOptions> & IGameMemory & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IGameMemory>;
export default _default;
//# sourceMappingURL=GameMemory.d.ts.map
import mongoose, { Document } from 'mongoose';
export interface IPlayer extends Document {
    sessionId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IPlayer, {}, {}, {}, Document<unknown, {}, IPlayer, {}, mongoose.DefaultSchemaOptions> & IPlayer & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IPlayer>;
export default _default;
//# sourceMappingURL=Player.d.ts.map
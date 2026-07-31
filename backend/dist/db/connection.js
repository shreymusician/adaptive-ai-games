"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || '';
        if (!mongoURI) {
            throw new Error('MONGODB_URI environment variable is not set');
        }
        await mongoose_1.default.connect(mongoURI, {
            dbName: process.env.MONGODB_DB_NAME || 'adaptive-games',
        });
        console.log('MongoDB connected successfully');
        return mongoose_1.default.connection;
    }
    catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};
exports.default = connectDB;
//# sourceMappingURL=connection.js.map
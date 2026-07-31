"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const GameMemory_1 = __importDefault(require("../models/GameMemory"));
const GameSession_1 = __importDefault(require("../models/GameSession"));
const router = (0, express_1.Router)();
router.get('/memory/:playerId/:gameType', async (req, res) => {
    try {
        const { playerId, gameType } = req.params;
        const memory = await GameMemory_1.default.findOne({
            playerId,
            gameType: gameType,
        });
        if (!memory) {
            res.json({ data: {} });
            return;
        }
        res.json({ data: memory.data });
    }
    catch (error) {
        console.error('Memory fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch memory' });
    }
});
router.post('/memory/:playerId/:gameType', async (req, res) => {
    try {
        const { playerId, gameType } = req.params;
        const { data } = req.body;
        if (!data) {
            res.status(400).json({ error: 'data is required' });
            return;
        }
        let memory = await GameMemory_1.default.findOne({
            playerId,
            gameType: gameType,
        });
        if (!memory) {
            memory = new GameMemory_1.default({
                playerId,
                gameType: gameType,
                data,
            });
        }
        else {
            memory.data = data;
        }
        await memory.save();
        res.json({
            success: true,
            data: memory.data,
        });
    }
    catch (error) {
        console.error('Memory save error:', error);
        res.status(500).json({ error: 'Failed to save memory' });
    }
});
router.post('/match', async (req, res) => {
    try {
        const { playerId, gameType, won, duration } = req.body;
        if (!playerId || !gameType || typeof won !== 'boolean' || !duration) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        const lastSession = await GameSession_1.default.findOne({
            playerId,
            gameType,
        }).sort({ matchNumber: -1 });
        const matchNumber = (lastSession?.matchNumber || 0) + 1;
        const session = new GameSession_1.default({
            playerId,
            gameType,
            matchNumber,
            won,
            duration,
            timestamp: new Date(),
        });
        await session.save();
        res.json({
            success: true,
            matchNumber,
        });
    }
    catch (error) {
        console.error('Match log error:', error);
        res.status(500).json({ error: 'Failed to log match' });
    }
});
router.get('/stats/:playerId/:gameType', async (req, res) => {
    try {
        const { playerId, gameType } = req.params;
        const sessions = await GameSession_1.default.find({
            playerId,
            gameType: gameType,
        });
        const wins = sessions.filter((s) => s.won).length;
        const total = sessions.length;
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        res.json({
            playerId,
            gameType,
            totalMatches: total,
            wins,
            losses: total - wins,
            winRate: winRate.toFixed(2),
        });
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});
exports.default = router;
//# sourceMappingURL=memory.js.map
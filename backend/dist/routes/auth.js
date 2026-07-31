"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Player_1 = __importDefault(require("../models/Player"));
const router = (0, express_1.Router)();
router.post('/player', async (req, res) => {
    try {
        const { sessionId, name } = req.body;
        if (!sessionId || !name) {
            res.status(400).json({ error: 'sessionId and name are required' });
            return;
        }
        let player = await Player_1.default.findOne({ sessionId });
        if (!player) {
            player = new Player_1.default({
                sessionId,
                name,
            });
            await player.save();
        }
        res.json({
            id: player._id,
            sessionId: player.sessionId,
            name: player.name,
        });
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Failed to authenticate player' });
    }
});
router.get('/player/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const player = await Player_1.default.findOne({ sessionId });
        if (!player) {
            res.status(404).json({ error: 'Player not found' });
            return;
        }
        res.json({
            id: player._id,
            sessionId: player.sessionId,
            name: player.name,
        });
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Failed to fetch player' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map
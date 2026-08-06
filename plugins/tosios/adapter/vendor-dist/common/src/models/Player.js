"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.movePlayer = movePlayer;
const geometry_1 = require("../geometry");
const __1 = require("..");
function movePlayer(x, y, radius, dirX, dirY, speed, walls) {
    // Move
    const magnitude = __1.Maths.normalize2D(dirX, dirY);
    const speedX = Math.round(__1.Maths.round2Digits(dirX * (speed / magnitude)));
    const speedY = Math.round(__1.Maths.round2Digits(dirY * (speed / magnitude)));
    x += speedX;
    y += speedY;
    // Collide
    const corrected = walls.correctWithCircle(new geometry_1.CircleBody(x, y, radius));
    x = corrected.x;
    y = corrected.y;
    return { x, y };
}

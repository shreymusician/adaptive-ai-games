"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAngle = calculateAngle;
exports.lerp = lerp;
exports.getDistance = getDistance;
exports.getRandomInt = getRandomInt;
exports.clamp = clamp;
exports.round2Digits = round2Digits;
exports.normalize2D = normalize2D;
exports.degreeToCardinal = degreeToCardinal;
exports.reverseNumber = reverseNumber;
exports.snapPosition = snapPosition;
exports.shuffleArray = shuffleArray;
exports.rad2Deg = rad2Deg;
exports.normalize = normalize;
/**
 * Get the angle in radiant between two points
 * @param x1
 * @param y1
 * @param x2
 * @param y2
 */
function calculateAngle(x1, y1, x2, y2) {
    return Math.atan2(y1 - y2, x1 - x2);
}
/**
 * Lerp between two values
 * @param a
 * @param b
 * @param n
 */
function lerp(a, b, n) {
    return (1 - n) * a + n * b;
}
/**
 * Get the distance between two points
 * @param x
 * @param y
 * @param toX
 * @param toY
 */
function getDistance(x, y, toX, toY) {
    return Math.hypot(toX - x, toY - y);
}
/**
 * Get a random integer between min and max.
 * @param {number} min - min number
 * @param {number} max - max number
 */
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
/**
 * Clamp a value
 * @param value
 * @param min
 * @param max
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/**
 * Round a floating number to 2 digits
 * @param value
 */
function round2Digits(value) {
    return Math.round(Math.round(value * 1000) / 10) / 100;
}
/**
 * Normalize a vector
 * @param ax
 * @param ay
 */
function normalize2D(ax, ay) {
    return Math.sqrt(ax * ax + ay * ay);
}
function degreeToCardinal(degree) {
    const cardinals = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const remainder = degree % 360;
    const index = Math.round((remainder < 0 ? degree + 360 : degree) / 45) % 8;
    return cardinals[index];
}
/**
 * Reverse a number between a range
 * @example
 * reverseNumber(1.2, 0, 3) // returns 1.8
 */
function reverseNumber(num, min, max) {
    return max + min - num;
}
/**
 * Snap a position on a grid with TILE_SIZE cells
 * @param pos The position to snap
 * @param tileSize The tile size to snap to
 */
function snapPosition(pos, tileSize) {
    const rest = pos % tileSize;
    return rest < tileSize / 2 ? -rest : tileSize - rest;
}
/**
 * Shuffles an array
 */
function shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = result[i];
        result[i] = result[j];
        result[j] = temp;
    }
    return result;
}
/**
 * Convert radians to degrees
 */
function rad2Deg(radians) {
    return (radians * 180) / Math.PI;
}
/**
 * Normalize a number
 */
function normalize(value, min, max) {
    return (value - min) / (max - min);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.circleToRectangles = exports.rectangleToRectangles = exports.correctedPositionFromSide = exports.circleToRectangle = exports.circleToCircle = exports.rectangleToRectangle = exports.circleToRectangleSide = exports.rectangleToRectangleSide = void 0;
const maths_1 = require("../maths");
/**
 * Return which side of the second Rectangle the first collides with
 */
const rectangleToRectangleSide = (r1, r2) => {
    const dx = r1.x + r1.width / 2 - (r2.x + r2.width / 2);
    const dy = r1.y + r1.height / 2 - (r2.y + r2.height / 2);
    const width = (r1.width + r2.width) / 2;
    const height = (r1.height + r2.height) / 2;
    const crossWidth = width * dy;
    const crossHeight = height * dx;
    let collision = 'none';
    if (Math.abs(dx) <= width && Math.abs(dy) <= height) {
        if (crossWidth > crossHeight) {
            collision = crossWidth > -crossHeight ? 'bottom' : 'left';
        }
        else {
            collision = crossWidth > -crossHeight ? 'right' : 'top';
        }
    }
    return collision;
};
exports.rectangleToRectangleSide = rectangleToRectangleSide;
/**
 * Return which side of the Rectangle is the Circle colliding with
 */
const circleToRectangleSide = (c, r) => {
    return (0, exports.rectangleToRectangleSide)(c.box, r);
};
exports.circleToRectangleSide = circleToRectangleSide;
/**
 * Rectangle to Rectangle
 */
const rectangleToRectangle = (r1, r2) => {
    return r1.left < r2.right && r1.right > r2.left && r1.top < r2.bottom && r1.bottom > r2.top;
};
exports.rectangleToRectangle = rectangleToRectangle;
/**
 * Circle to Circle
 */
const circleToCircle = (c1, c2) => {
    const distance = Math.abs((0, maths_1.getDistance)(c1.x, c1.y, c2.x, c2.y));
    return distance < c1.radius + c2.radius;
};
exports.circleToCircle = circleToCircle;
/**
 * Circle to Rectangle
 */
const circleToRectangle = (c, r) => {
    let testX = c.x;
    let testY = c.y;
    if (c.x < r.x) {
        testX = r.x;
    }
    else if (c.x > r.right) {
        testX = r.right;
    }
    if (c.y < r.y) {
        testY = r.y;
    }
    else if (c.y > r.bottom) {
        testY = r.bottom;
    }
    const distX = c.x - testX;
    const distY = c.y - testY;
    const distance = Math.sqrt(distX * distX + distY * distY);
    return distance <= c.radius;
};
exports.circleToRectangle = circleToRectangle;
const correctedPositionFromSide = (from, to, side) => {
    const corrected = from.copy();
    switch (side) {
        // Collides with the "left" of [to]
        case 'left':
            corrected.right = to.left;
            break;
        // Collides with the "top" of [to]
        case 'top':
            corrected.bottom = to.top;
            break;
        // Collides with the "right" of [to]
        case 'right':
            corrected.left = to.right;
            break;
        // Collides with the "bottom" of [to]
        case 'bottom':
            corrected.top = to.bottom;
            break;
        default:
            break;
    }
    return corrected;
};
exports.correctedPositionFromSide = correctedPositionFromSide;
/**
 * Check a Rectangle collisions against a list of Rectangles
 * @returns a corrected position RectangleBody
 */
const rectangleToRectangles = (rectangle, rectangles) => {
    const corrected = rectangle.copy();
    let colliding = false;
    for (const item of rectangles) {
        if ((0, exports.rectangleToRectangle)(corrected, item)) {
            colliding = true;
            switch ((0, exports.rectangleToRectangleSide)(corrected, item)) {
                case 'left':
                    corrected.right = item.x;
                    break;
                case 'top':
                    corrected.bottom = item.top;
                    break;
                case 'right':
                    corrected.left = item.right;
                    break;
                case 'bottom':
                    corrected.top = item.bottom;
                    break;
                default:
                    break;
            }
        }
    }
    return colliding ? corrected : null;
};
exports.rectangleToRectangles = rectangleToRectangles;
/**
 * Check a Circle collisions against a list of Rectangles
 * @returns a corrected position RectangleBody
 */
const circleToRectangles = (circle, rectangles) => {
    const corrected = circle.copy();
    let colliding = false;
    for (const item of rectangles) {
        if ((0, exports.circleToRectangle)(corrected, item)) {
            colliding = true;
            switch ((0, exports.circleToRectangleSide)(corrected, item)) {
                case 'left':
                    corrected.right = item.x;
                    break;
                case 'top':
                    corrected.bottom = item.top;
                    break;
                case 'right':
                    corrected.left = item.right;
                    break;
                case 'bottom':
                    corrected.top = item.bottom;
                    break;
                default:
                    break;
            }
        }
    }
    return colliding ? corrected : null;
};
exports.circleToRectangles = circleToRectangles;

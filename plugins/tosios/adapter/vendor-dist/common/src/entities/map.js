"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Map = void 0;
const geometry_1 = require("../geometry");
const __1 = require("..");
class Map {
    // Init
    constructor(width, height) {
        this.isRectangleOutside = (rectangle) => {
            return rectangle.x < 0 || rectangle.right > this.width || rectangle.y < 0 || rectangle.bottom > this.height;
        };
        this.isCircleOutside = (circle) => {
            return circle.left < 0 || circle.right > this.width || circle.top < 0 || circle.bottom > this.height;
        };
        this.width = width;
        this.height = height;
    }
    // Methods
    isVectorOutside(x, y) {
        return x < 0 || x > this.width || y < 0 || y < this.height;
    }
    clampRectangle(rectangle) {
        return new geometry_1.Vector2(__1.Maths.clamp(rectangle.x, 0, this.width - rectangle.width), __1.Maths.clamp(rectangle.y, 0, this.height - rectangle.height));
    }
    clampCircle(circle) {
        return new geometry_1.Vector2(__1.Maths.clamp(circle.x, circle.radius, this.width - circle.radius), __1.Maths.clamp(circle.y, circle.radius, this.height - circle.radius));
    }
    // Setters
    setDimensions(width, height) {
        this.width = width;
        this.height = height;
    }
}
exports.Map = Map;

import { CircleBody, RectangleBody, Vector2 } from '../geometry';
export declare class Map {
    width: number;
    height: number;
    constructor(width: number, height: number);
    isVectorOutside(x: number, y: number): boolean;
    isRectangleOutside: (rectangle: RectangleBody) => boolean;
    isCircleOutside: (circle: CircleBody) => boolean;
    clampRectangle(rectangle: RectangleBody): Vector2;
    clampCircle(circle: CircleBody): Vector2;
    setDimensions(width: number, height: number): void;
}

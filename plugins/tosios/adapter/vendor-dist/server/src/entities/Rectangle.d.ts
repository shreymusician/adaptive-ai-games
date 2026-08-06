import { Schema } from '@colyseus/schema';
import { Geometry } from '@tosios/common';
export declare class Rectangle extends Schema {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x: number, y: number, width: number, height: number);
    get body(): Geometry.RectangleBody;
}

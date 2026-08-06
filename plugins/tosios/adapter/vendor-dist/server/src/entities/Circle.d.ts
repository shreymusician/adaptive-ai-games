import { Schema } from '@colyseus/schema';
import { Geometry } from '@tosios/common';
export declare class Circle extends Schema {
    x: number;
    y: number;
    radius: number;
    constructor(x: number, y: number, radius: number);
    get body(): Geometry.CircleBody;
}

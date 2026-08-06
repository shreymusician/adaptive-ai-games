import { Circle } from '.';
import { Models } from '@tosios/common';
export declare class Prop extends Circle {
    type: Models.PropType;
    active: boolean;
    constructor(propType: Models.PropType, x: number, y: number, radius: number);
}

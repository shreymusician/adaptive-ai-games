import { CollisionType } from './types';
import { CircleBody, RectangleBody } from '../geometry';
import RBush from 'rbush';
/**
 * A R-Tree implementation handling Rectangle and Circle bodies
 */
export declare class TreeCollider extends RBush<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    collider: string;
}> {
    collidesWithRectangle(body: RectangleBody, type?: CollisionType): boolean;
    collidesWithCircle(body: CircleBody, type?: CollisionType): boolean;
    searchWithRectangle(body: RectangleBody): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        collider: string;
    }[];
    searchWithCircle(body: CircleBody): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        collider: string;
    }[];
    correctWithRectangle(body: RectangleBody): RectangleBody;
    correctWithCircle(body: CircleBody): CircleBody;
    getAllByType(type: number): RectangleBody[];
}

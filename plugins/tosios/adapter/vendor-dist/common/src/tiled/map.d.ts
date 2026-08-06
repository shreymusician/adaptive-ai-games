import { ISpriteLayer, ITile, ITileSets } from './types';
import { TMX } from './tmx';
/**
 * A class used to parse Tiled maps from JSON.
 */
export declare class Map {
    private mapWidthUnits;
    private mapHeightUnits;
    private fixedTileSize;
    imageName: string;
    tilesets: ITileSets;
    collisions: ITile[];
    spawners: ITile[];
    layers: ISpriteLayer[];
    constructor(data: TMX.IMap, fixedTileSize: number);
    private computeTileSets;
    private computeCollisions;
    private computeSpawners;
    private computeLayers;
    private parseLayer;
    get widthInUnits(): number;
    get heightInUnits(): number;
    get widthInPixels(): number;
    get heightInPixels(): number;
}

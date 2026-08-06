"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = void 0;
const schema_1 = require("@colyseus/schema");
const entities_1 = require("../entities");
const common_1 = require("@tosios/common");
class GameState extends schema_1.Schema {
    //
    // Init
    //
    constructor(roomName, mapName, maxPlayers, mode, onMessage) {
        super();
        this.players = new schema_1.MapSchema();
        this.monsters = new schema_1.MapSchema();
        this.props = new schema_1.ArraySchema();
        this.bullets = new schema_1.ArraySchema();
        this.spawners = [];
        this.actions = [];
        //
        // Game: State changes
        //
        this.handleWaitingStart = () => {
            this.setPlayersActive(false);
            this.onMessage({
                type: 'waiting',
                from: 'server',
                ts: Date.now(),
                params: {},
            });
        };
        this.handleLobbyStart = () => {
            this.setPlayersActive(false);
        };
        this.handleGameStart = () => {
            if (this.game.mode === 'team deathmatch') {
                this.setPlayersTeamsRandomly();
            }
            this.setPlayersPositionRandomly();
            this.setPlayersActive(true);
            this.propsAdd(common_1.Constants.FLASKS_COUNT);
            this.monstersAdd(common_1.Constants.MONSTERS_COUNT);
            this.onMessage({
                type: 'start',
                from: 'server',
                ts: Date.now(),
                params: {},
            });
        };
        this.handleGameEnd = (message) => {
            if (message) {
                this.onMessage(message);
            }
            this.propsClear();
            this.monstersClear();
            this.onMessage({
                type: 'stop',
                from: 'server',
                ts: Date.now(),
                params: {},
            });
        };
        //
        // Map
        //
        this.initializeMap = (mapName) => {
            const data = common_1.Maps.List[mapName];
            const tiledMap = new common_1.Tiled.Map(data, common_1.Constants.TILE_SIZE);
            // Set the map boundaries
            this.map = new common_1.Entities.Map(tiledMap.widthInPixels, tiledMap.heightInPixels);
            // Create a R-Tree for walls
            this.walls = new common_1.Collisions.TreeCollider();
            tiledMap.collisions.forEach((tile) => {
                if (tile.tileId > 0) {
                    this.walls.insert({
                        minX: tile.minX,
                        minY: tile.minY,
                        maxX: tile.maxX,
                        maxY: tile.maxY,
                        collider: tile.type,
                    });
                }
            });
            // Create spawners
            tiledMap.spawners.forEach((tile) => {
                if (tile.tileId > 0) {
                    this.spawners.push(new common_1.Geometry.RectangleBody(tile.minX, tile.minY, tile.maxX, tile.maxY));
                }
            });
        };
        //
        // Monsters
        //
        this.monstersAdd = (count) => {
            for (let i = 0; i < count; i++) {
                const body = this.getPositionRandomly(new common_1.Geometry.CircleBody(0, 0, common_1.Constants.MONSTER_SIZE / 2), false, false);
                const monster = new entities_1.Monster(body.x, body.y, body.width / 2, this.map.width, this.map.height, common_1.Constants.MONSTER_LIVES);
                this.monsters.set(common_1.Maths.getRandomInt(0, 1000).toString(), monster);
            }
        };
        this.monsterUpdate = (id) => {
            const monster = this.monsters.get(id);
            if (!monster || !monster.isAlive) {
                return;
            }
            // Update monster
            monster.update(this.players);
            // Collisions: Players
            this.players.forEach((player) => {
                // Check if the monster can hurt the player
                if (!player.isAlive || !monster.canAttack || !common_1.Collisions.circleToCircle(monster.body, player.body)) {
                    return;
                }
                monster.attack();
                player.hurt();
                if (!player.isAlive) {
                    this.onMessage({
                        type: 'killed',
                        from: 'server',
                        ts: Date.now(),
                        params: {
                            killerName: 'A bat',
                            killedName: player.name,
                        },
                    });
                }
            });
        };
        this.monsterRemove = (id) => {
            this.monsters.delete(id);
        };
        this.monstersClear = () => {
            const monstersIds = Array.from(this.monsters.keys());
            monstersIds.forEach(this.monsterRemove);
        };
        // Game
        this.game = new entities_1.Game({
            roomName,
            mapName,
            maxPlayers,
            mode,
            onWaitingStart: this.handleWaitingStart,
            onLobbyStart: this.handleLobbyStart,
            onGameStart: this.handleGameStart,
            onGameEnd: this.handleGameEnd,
        });
        // Map
        this.initializeMap(mapName);
        // Callback
        this.onMessage = onMessage;
    }
    //
    // Updates
    //
    update() {
        this.updateGame();
        this.updatePlayers();
        this.updateMonsters();
        this.updateBullets();
    }
    updateGame() {
        this.game.update(this.players);
    }
    updatePlayers() {
        let action;
        while (this.actions.length > 0) {
            action = this.actions.shift();
            switch (action.type) {
                case 'move':
                    this.playerMove(action.playerId, action.ts, action.value);
                    break;
                case 'rotate':
                    this.playerRotate(action.playerId, action.ts, action.value.rotation);
                    break;
                case 'shoot':
                    this.playerShoot(action.playerId, action.ts, action.value.angle);
                    break;
                default:
                    break;
            }
        }
    }
    updateMonsters() {
        this.monsters.forEach((monster, monsterId) => {
            this.monsterUpdate(monsterId);
        });
    }
    updateBullets() {
        for (let i = 0; i < this.bullets.length; i++) {
            this.bulletUpdate(i);
        }
    }
    //
    // Players: single
    //
    playerAdd(id, name) {
        const spawner = this.getSpawnerRandomly();
        const player = new entities_1.Player(id, spawner.x + common_1.Constants.PLAYER_SIZE / 2, spawner.y + common_1.Constants.PLAYER_SIZE / 2, common_1.Constants.PLAYER_SIZE / 2, 0, common_1.Constants.PLAYER_MAX_LIVES, name || id);
        // Add the user to the "red" team by default
        if (this.game.mode === 'team deathmatch') {
            player.setTeam('Red');
        }
        this.players.set(id, player);
        // Broadcast message to other players
        this.onMessage({
            type: 'joined',
            from: 'server',
            ts: Date.now(),
            params: {
                name: this.players.get(id).name,
            },
        });
    }
    playerPushAction(action) {
        this.actions.push(action);
    }
    playerMove(id, ts, dir) {
        const player = this.players.get(id);
        if (!player || dir.empty) {
            return;
        }
        player.move(dir.x, dir.y, common_1.Constants.PLAYER_SPEED);
        // Collisions: Map
        const clampedPosition = this.map.clampCircle(player.body);
        player.setPosition(clampedPosition.x, clampedPosition.y);
        // Collisions: Walls
        const correctedPosition = this.walls.correctWithCircle(player.body);
        player.setPosition(correctedPosition.x, correctedPosition.y);
        // Acknoledge last treated action
        player.ack = ts;
        // Collisions: Props
        if (!player.isAlive) {
            return;
        }
        let prop;
        for (let i = 0; i < this.props.length; i++) {
            prop = this.props[i];
            if (!prop.active) {
                continue;
            }
            if (common_1.Collisions.circleToCircle(player.body, prop.body)) {
                switch (prop.type) {
                    case 'potion-red':
                        if (!player.isFullLives) {
                            prop.active = false;
                            player.heal();
                        }
                        break;
                    default:
                        break;
                }
            }
        }
    }
    playerRotate(id, ts, rotation) {
        const player = this.players.get(id);
        if (!player) {
            return;
        }
        player.setRotation(rotation);
    }
    playerShoot(id, ts, angle) {
        const player = this.players.get(id);
        if (!player || !player.isAlive || this.game.state !== 'game') {
            return;
        }
        // Check if player can shoot
        const delta = ts - player.lastShootAt;
        if (player.lastShootAt && delta < common_1.Constants.BULLET_RATE) {
            return;
        }
        player.lastShootAt = ts;
        // Make the bullet start at the staff
        const bulletX = player.x + Math.cos(angle) * common_1.Constants.PLAYER_WEAPON_SIZE;
        const bulletY = player.y + Math.sin(angle) * common_1.Constants.PLAYER_WEAPON_SIZE;
        // Recycle bullets if some are unused to prevent instantiating too many
        const index = this.bullets.findIndex((bullet) => !bullet.active);
        if (index === -1) {
            this.bullets.push(new entities_1.Bullet(id, player.team, bulletX, bulletY, common_1.Constants.BULLET_SIZE, angle, player.color, Date.now()));
        }
        else {
            this.bullets[index].reset(id, player.team, bulletX, bulletY, common_1.Constants.BULLET_SIZE, angle, player.color, Date.now());
        }
    }
    playerUpdateKills(playerId) {
        const player = this.players.get(playerId);
        if (!player) {
            return;
        }
        player.setKills(player.kills + 1);
    }
    playerRemove(id) {
        this.onMessage({
            type: 'left',
            from: 'server',
            ts: Date.now(),
            params: {
                name: this.players.get(id).name,
            },
        });
        this.players.delete(id);
    }
    //
    // Players: multiple
    //
    setPlayersActive(active) {
        this.players.forEach((player) => {
            player.setLives(active ? player.maxLives : 0);
        });
    }
    setPlayersPositionRandomly() {
        let spawner;
        this.players.forEach((player) => {
            spawner = this.getSpawnerRandomly();
            player.setPosition(spawner.x + common_1.Constants.PLAYER_SIZE / 2, spawner.y + common_1.Constants.PLAYER_SIZE / 2);
            player.ack = 0;
        });
    }
    getPositionRandomly(body, snapToGrid, withCollisions) {
        body.x = common_1.Maths.getRandomInt(common_1.Constants.TILE_SIZE, this.map.width - common_1.Constants.TILE_SIZE);
        body.y = common_1.Maths.getRandomInt(common_1.Constants.TILE_SIZE, this.map.height - common_1.Constants.TILE_SIZE);
        // Should we compute collisions?
        if (withCollisions) {
            while (this.walls.collidesWithCircle(body)) {
                body.x = common_1.Maths.getRandomInt(common_1.Constants.TILE_SIZE, this.map.width - common_1.Constants.TILE_SIZE);
                body.y = common_1.Maths.getRandomInt(common_1.Constants.TILE_SIZE, this.map.height - common_1.Constants.TILE_SIZE);
            }
        }
        // We want the items to snap to the grid
        if (snapToGrid) {
            body.x += common_1.Maths.snapPosition(body.x, common_1.Constants.TILE_SIZE);
            body.y += common_1.Maths.snapPosition(body.y, common_1.Constants.TILE_SIZE);
        }
        return body;
    }
    setPlayersTeamsRandomly() {
        const playersIds = common_1.Maths.shuffleArray(Array.from(this.players.keys()));
        const minimumPlayersPerTeam = Math.floor(playersIds.length / 2);
        const rest = playersIds.length % 2;
        for (let i = 0; i < playersIds.length; i++) {
            const playerId = playersIds[i];
            const player = this.players.get(playerId);
            const isBlueTeam = i < minimumPlayersPerTeam + rest;
            player.setTeam(isBlueTeam ? 'Blue' : 'Red');
        }
    }
    getSpawnerRandomly() {
        return this.spawners[common_1.Maths.getRandomInt(0, this.spawners.length - 1)];
    }
    //
    // Bullets
    //
    bulletUpdate(bulletId) {
        const bullet = this.bullets[bulletId];
        if (!bullet || !bullet.active) {
            return;
        }
        bullet.move(common_1.Constants.BULLET_SPEED);
        // Collisions: Players
        this.players.forEach((player) => {
            // Check if the bullet can hurt the player
            if (!player.canBulletHurt(bullet.playerId, bullet.team) ||
                !common_1.Collisions.circleToCircle(bullet.body, player.body)) {
                return;
            }
            bullet.active = false;
            player.hurt();
            if (!player.isAlive) {
                this.onMessage({
                    type: 'killed',
                    from: 'server',
                    ts: Date.now(),
                    params: {
                        killerName: this.players[bullet.playerId].name,
                        killedName: player.name,
                    },
                });
                this.playerUpdateKills(bullet.playerId);
            }
        });
        // Collisions: Monsters
        this.monsters.forEach((monster, monsterId) => {
            // Check if the bullet can hurt the player
            if (!common_1.Collisions.circleToCircle(bullet.body, monster.body)) {
                return;
            }
            bullet.active = false;
            monster.hurt();
            if (!monster.isAlive) {
                this.monsterRemove(monsterId);
            }
        });
        // Collisions: Walls
        if (this.walls.collidesWithCircle(bullet.body, 'half')) {
            bullet.active = false;
            return;
        }
        // Collisions: Map
        if (this.map.isCircleOutside(bullet.body)) {
            bullet.active = false;
        }
    }
    //
    // Props
    //
    propsAdd(count) {
        for (let i = 0; i < count; i++) {
            const body = this.getPositionRandomly(new common_1.Geometry.CircleBody(0, 0, common_1.Constants.FLASK_SIZE / 2), false, true);
            const prop = new entities_1.Prop('potion-red', body.x, body.y, body.radius);
            this.props.push(prop);
        }
    }
    propsClear() {
        if (!this.props) {
            return;
        }
        while (this.props.length > 0) {
            this.props.pop();
        }
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.type)(entities_1.Game)
], GameState.prototype, "game", void 0);
__decorate([
    (0, schema_1.type)({ map: entities_1.Player })
], GameState.prototype, "players", void 0);
__decorate([
    (0, schema_1.type)({ map: entities_1.Monster })
], GameState.prototype, "monsters", void 0);
__decorate([
    (0, schema_1.type)([entities_1.Prop])
], GameState.prototype, "props", void 0);
__decorate([
    (0, schema_1.type)([entities_1.Bullet])
], GameState.prototype, "bullets", void 0);

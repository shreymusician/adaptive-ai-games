import { RouteComponentProps } from '@reach/router';
import { Constants, Models, Types } from '@tosios/common';
import { Client, Room } from 'colyseus.js';
import qs from 'querystringify';
import React, { useEffect, useRef, useState } from 'react';
import { isMobile } from 'react-device-detect';
import { Helmet } from 'react-helmet';
import { View } from '../../components';
import { Game } from '../../game/Game';
import { HUDProps } from './components/HUD';
import { HUD } from './components/HUD/HUD';
import { JoystickDirections, JoySticks } from './components/JoySticks';

interface GameScreenProps
    extends RouteComponentProps<{
        roomId: string;
    }> {}

export function GameScreen({ navigate, location, roomId }: GameScreenProps) {
    const [hud, setHUD] = useState<HUDProps>({
        gameMode: '',
        gameMap: '',
        gameModeEndsAt: 0,
        roomName: '',
        playerId: '',
        playerName: '',
        playerLives: 0,
        playerMaxLives: 0,
        players: [],
        playersCount: 0,
        playersMaxCount: 0,
        messages: [],
        announce: '',
    });

    const canvasRef = useRef<HTMLDivElement>();
    const clientRef = useRef<Client>();
    const gameRef = useRef<Game>();
    const roomRef = useRef<Room>();
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    //
    // Lifecycle
    //
    useEffect(() => {
        start();

        return () => {
            stop();
        };
    }, []);

    //
    // Methods
    //
    async function start() {
        gameRef.current = new Game(window.innerWidth, window.innerHeight, handleActionSend);

        const { search = '' } = location || {};

        const isNewRoom = roomId === 'new';
        const parsedSearch = qs.parse(search) as Types.RoomOptions;

        let options;
        if (isNewRoom) {
            options = {
                ...parsedSearch,
                roomMaxPlayers: Number(parsedSearch.roomMaxPlayers),
            };
        } else {
            // The only thing to pass when joining an existing room is a player's name
            options = {
                playerName: localStorage.getItem('playerName'),
            };
        }

        // Connect
        try {
            const host = window.document.location.host.replace(/:.*/, '');
            const port = process.env.NODE_ENV !== 'production' ? Constants.WS_PORT : window.location.port;
            const url = `${window.location.protocol.replace('http', 'ws')}//${host}${port ? `:${port}` : ''}`;

            clientRef.current = new Client(url);
            if (isNewRoom) {
                roomRef.current = await clientRef.current.create(Constants.ROOM_NAME, options);

                // We replace the "new" in the URL with the room's id
                window.history.replaceState(null, '', `/${roomRef.current.id}`);
            } else {
                roomRef.current = await clientRef.current.joinById(roomId, options);
            }
        } catch (error) {
            navigate('/');
            return;
        }

        // Set the current player id
        const playerId = roomRef.current.sessionId;
        setHUD((prev) => ({
            ...prev,
            playerId,
        }));

        // Listen for state changes
        roomRef.current.state.game.onChange = handleGameChange;
        roomRef.current.state.players.onAdd = handlePlayerAdd;
        roomRef.current.state.players.onRemove = handlePlayerRemove;
        roomRef.current.state.monsters.onAdd = handleMonsterAdd;
        roomRef.current.state.monsters.onRemove = handleMonsterRemove;
        roomRef.current.state.props.onAdd = handlePropAdd;
        roomRef.current.state.props.onRemove = handlePropRemove;
        roomRef.current.state.bullets.onAdd = handleBulletAdd;
        roomRef.current.state.bullets.onRemove = handleBulletRemove;

        // Listen for Messages
        roomRef.current.onMessage('*', handleMessage);

        // Start game
        gameRef.current.start(canvasRef.current);

        // Listen for inputs
        window.addEventListener('resize', handleWindowResize);

        // Start players refresh listeners
        intervalRef.current = setInterval(updateRoom, Constants.PLAYERS_REFRESH);
    }

    async function stop() {
        // Colyseus
        if (roomRef.current) {
            roomRef.current.leave();
        }

        // Game
        gameRef.current.stop();

        // Inputs
        window.removeEventListener('resize', handleWindowResize);

        // Start players refresh listeners
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    }

    //
    // Utils
    //
    function isPlayerIdMe(playerId: string) {
        return playerId === roomRef.current?.sessionId;
    }

    function updateRoom() {
        const stats = gameRef.current.getStats();

        setHUD((prev) => ({
            ...prev,
            ...stats,
        }));
    }

    //
    // Handlers
    //

    // Colyseus
    function handleGameChange(attributes: any) {
        for (const row of attributes) {
            gameRef.current.gameUpdate(row.field, row.value);
        }
    }

    function handlePlayerAdd(player: any, playerId: string) {
        const isMe = isPlayerIdMe(playerId);
        gameRef.current.playerAdd(playerId, player, isMe);
        updateRoom();

        player.onChange = () => {
            handlePlayerUpdate(player, playerId);
        };
    }

    function handlePlayerUpdate(player: any, playerId: string) {
        const isMe = isPlayerIdMe(playerId);
        gameRef.current.playerUpdate(playerId, player, isMe);
    }

    function handlePlayerRemove(player: Models.PlayerJSON, playerId: string) {
        const isMe = isPlayerIdMe(playerId);
        gameRef.current.playerRemove(playerId, isMe);
        updateRoom();
    }

    function handleMonsterAdd(monster: any, monsterId: string) {
        gameRef.current.monsterAdd(monsterId, monster);

        monster.onChange = () => {
            handleMonsterUpdate(monster, monsterId);
        };
    }

    function handleMonsterUpdate(monster: Models.MonsterJSON, monsterId: string) {
        gameRef.current.monsterUpdate(monsterId, monster);
    }

    function handleMonsterRemove(monster: Models.MonsterJSON, monsterId: string) {
        gameRef.current.monsterRemove(monsterId);
    }

    function handlePropAdd(prop: any, propId: string) {
        gameRef.current.propAdd(propId, prop);
        prop.onChange = () => {
            handlePropUpdate(prop, propId);
        };
    }

    function handlePropUpdate(prop: Models.PropJSON, propId: string) {
        gameRef.current.propUpdate(propId, prop);
    }

    function handlePropRemove(prop: Models.PropJSON, propId: string) {
        gameRef.current.propRemove(propId);
    }

    function handleBulletAdd(bullet: Models.BulletJSON, bulletId: string) {
        gameRef.current.bulletAdd(bulletId, bullet);
    }

    function handleBulletRemove(bullet: Models.BulletJSON, bulletId: string) {
        gameRef.current.bulletRemove(bulletId);
    }

    function handleMessage(type: any, message: Models.MessageJSON) {
        const { messages } = hud;

        let announce: string | undefined;
        switch (type) {
            case 'waiting':
                announce = `Waiting for other players...`;
                break;
            case 'start':
                announce = `Game starts`;
                break;
            case 'won':
                announce = `${message.params.name} wins!`;
                break;
            case 'timeout':
                announce = `Timeout...`;
                break;
            default:
                break;
        }

        setHUD((prev) => ({
            ...prev,
            // Only set the last n messages (negative value on slice() is reverse)
            messages: [...messages, message].slice(-Constants.LOG_LINES_MAX),
            announce,
        }));

        updateRoom();
    }

    // GameManager
    function handleActionSend(action: Models.ActionJSON) {
        if (!roomRef.current) {
            return;
        }

        roomRef.current.send(action.type, action);
    }

    // Listeners
    function handleWindowResize() {
        gameRef.current.setScreenSize(window.innerWidth, window.innerHeight);
    }

    function handleJoyStickLeftMove(directions: JoystickDirections) {
        gameRef.current.inputs.up = directions.up;
        gameRef.current.inputs.right = directions.right;
        gameRef.current.inputs.down = directions.down;
        gameRef.current.inputs.left = directions.left;
    }

    function handleJoyStickLeftRelease() {
        gameRef.current.inputs.up = false;
        gameRef.current.inputs.right = false;
        gameRef.current.inputs.down = false;
        gameRef.current.inputs.left = false;
    }

    function handleJoyStickRightMove(rotation: number) {
        gameRef.current.forcedRotation = rotation;
        gameRef.current.inputs.shoot = true;
    }

    function handleJoyStickRightRelease() {
        gameRef.current.forcedRotation = null;
        gameRef.current.inputs.shoot = false;
    }

    return (
        <View
            style={{
                position: 'relative',
                height: '100%',
            }}
        >
            {/* Set page's title */}
            <Helmet>
                <title>{`${hud.roomName || hud.gameMode} [${hud.playersCount}]`}</title>
            </Helmet>

            {/* Where PIXI is injected */}
            <div ref={canvasRef} />

            {/* Joysticks */}
            {isMobile && (
                <JoySticks
                    onLeftMove={handleJoyStickLeftMove}
                    onLeftRelease={handleJoyStickLeftRelease}
                    onRightMove={handleJoyStickRightMove}
                    onRightRelease={handleJoyStickRightRelease}
                />
            )}

            {/* HUD: GUI, menu, leaderboard */}
            <HUD
                playerId={hud.playerId}
                gameMode={hud.gameMode}
                gameMap={hud.gameMap}
                gameModeEndsAt={hud.gameModeEndsAt}
                roomName={hud.roomName}
                playerName={hud.playerName}
                playerLives={hud.playerLives}
                playerMaxLives={hud.playerMaxLives}
                players={hud.players}
                playersCount={hud.playersCount}
                playersMaxCount={hud.playersMaxCount}
                messages={hud.messages}
                announce={hud.announce}
            />
        </View>
    );
}

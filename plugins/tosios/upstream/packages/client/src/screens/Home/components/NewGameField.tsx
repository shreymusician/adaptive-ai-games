import { Constants } from '@tosios/common';
import { GameMode } from '@tosios/common/src/types';
import React, { useState } from 'react';
import { Button, Input, ListItem, Select, Space, Text, View } from '../../../components';

const MapsList: ListItem[] = Constants.MAPS_NAMES.map((value) => ({
    value,
    title: value,
}));

const PlayersCountList: ListItem[] = Constants.ROOM_PLAYERS_SCALES.map((value) => ({
    value,
    title: `${value} players`,
}));

const GameModesList: ListItem[] = Constants.GAME_MODES.map((value) => ({
    value,
    title: value,
}));

interface NewGameFieldProps {
    onCreate: (name: string, maxPlayers: number, map: string, mode: string) => void;
}

export function NewGameField({ onCreate }: NewGameFieldProps) {
    const [opened, setOpened] = useState(false);
    const [name, setName] = useState('');
    const [maxPlayers, setMaxPlayers] = useState(PlayersCountList[0].value);
    const [map, setMap] = useState(MapsList[0].value);
    const [mode, setMode] = useState<GameMode>(GameModesList[0].value);

    function handleRoomNameChange(event: any) {
        const roomName = event.target.value;
        localStorage.setItem('roomName', roomName);
        setName(roomName);
    }

    function handleCreate() {
        onCreate(name, maxPlayers, map, mode);
    }

    function handleCancel() {
        setOpened(false);
    }

    return (
        <View
            flex
            style={{
                alignItems: 'flex-start',
                flexDirection: 'column',
            }}
        >
            {!opened && <Button title="Create new room" text="+ New Room" onClick={() => setOpened(true)} />}
            {opened && (
                <View style={{ width: '100%' }}>
                    {/* Name */}
                    <Text>Name:</Text>
                    <Space size="xxs" />
                    <Input
                        placeholder="Name"
                        value={name}
                        maxLength={Constants.ROOM_NAME_MAX}
                        onChange={handleRoomNameChange}
                    />
                    <Space size="s" />

                    {/* Map */}
                    <Text>Map:</Text>
                    <Space size="xxs" />
                    <Select
                        value={map}
                        values={MapsList}
                        onChange={(event: any) => {
                            setMap(event.target.value);
                        }}
                    />
                    <Space size="s" />

                    {/* Players */}
                    <Text>Max players:</Text>
                    <Space size="xxs" />
                    <Select
                        value={maxPlayers}
                        values={PlayersCountList}
                        onChange={(event: any) => {
                            setMaxPlayers(event.target.value);
                        }}
                    />
                    <Space size="s" />

                    {/* Mode */}
                    <Text>Game mode:</Text>
                    <Space size="xxs" />
                    <Select
                        value={mode}
                        values={GameModesList}
                        onChange={(event: any) => {
                            setMode(event.target.value);
                        }}
                    />
                    <Space size="s" />

                    {/* Button */}
                    <View>
                        <Button title="Create room" text="Create" onClick={handleCreate} />
                        <Space size="xs" />
                        <Button title="Cancel" text="Cancel" reversed onClick={handleCancel} />
                    </View>
                </View>
            )}
        </View>
    );
}

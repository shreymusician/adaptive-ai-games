import { RoomAvailable } from 'colyseus.js';
import React, { Fragment } from 'react';
import { Room, Space, View } from '../../../components';

interface RoomsListProps {
    rooms: Array<RoomAvailable<any>>;
    onRoomClick: (roomId: string) => void;
}

export function RoomsList({ rooms, onRoomClick }: RoomsListProps) {
    if (!rooms || !rooms.length) {
        return (
            <View
                flex
                center
                style={{
                    borderRadius: 8,
                    backgroundColor: '#efefef',
                    color: 'darkgrey',
                    height: 128,
                }}
            >
                No rooms yet...
            </View>
        );
    }

    return (
        <>
            {rooms.map(({ roomId, metadata, clients, maxClients }, index) => {
                return (
                    <Fragment key={roomId}>
                        <Room
                            id={roomId}
                            roomName={metadata.roomName}
                            roomMap={metadata.roomMap}
                            clients={clients}
                            maxClients={maxClients}
                            mode={metadata.mode}
                            onClick={onRoomClick}
                        />
                        {index !== rooms.length - 1 && <Space size="xxs" />}
                    </Fragment>
                );
            })}
        </>
    );
}

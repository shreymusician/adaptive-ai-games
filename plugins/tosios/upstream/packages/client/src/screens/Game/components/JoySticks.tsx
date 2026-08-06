import { Maths } from '@tosios/common';
import React from 'react';
import ReactNipple from 'react-nipple';
import { View } from '../../../components';

export interface JoystickDirections {
    up: boolean;
    right: boolean;
    down: boolean;
    left: boolean;
}

interface JoySticksProps {
    onLeftMove: (directions: JoystickDirections) => void;
    onLeftRelease: () => void;
    onRightMove: (rotation: number) => void;
    onRightRelease: () => void;
}

export function JoySticks({ onLeftMove, onLeftRelease, onRightMove, onRightRelease }: JoySticksProps) {
    function handleLeftMove(event: any, data: any) {
        const cardinal = Maths.degreeToCardinal(data.angle.degree);
        const up = cardinal === 'NW' || cardinal === 'N' || cardinal === 'NE';
        const right = cardinal === 'NE' || cardinal === 'E' || cardinal === 'SE';
        const down = cardinal === 'SE' || cardinal === 'S' || cardinal === 'SW';
        const left = cardinal === 'SW' || cardinal === 'W' || cardinal === 'NW';

        onLeftMove({ up, right, down, left });
    }

    function handleLeftRelease() {
        onLeftRelease();
    }

    function handleRightMove(event: any, data: any) {
        const radians = Maths.round2Digits(data.angle.radian - Math.PI);
        let rotation = 0;
        if (radians < 0) {
            rotation = Maths.reverseNumber(radians, -Math.PI, 0);
        } else {
            rotation = Maths.reverseNumber(radians, 0, Math.PI);
        }

        onRightMove(rotation);
    }

    function handleRightRelease() {
        onRightRelease();
    }

    return (
        <View fullscreen>
            {/* Position */}
            <ReactNipple
                options={{ mode: 'static', position: { bottom: '20%', left: '20%' } }}
                onMove={handleLeftMove}
                onEnd={handleLeftRelease}
            />

            {/* Rotation + shoot */}
            <ReactNipple
                options={{ mode: 'static', position: { bottom: '20%', right: '20%' } }}
                onMove={handleRightMove}
                onEnd={handleRightRelease}
            />
        </View>
    );
}

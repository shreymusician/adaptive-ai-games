import React, { CSSProperties } from 'react';
import { isMobile } from 'react-device-detect';
import { Container } from '.';
import { Inline, Text } from '../../../../components';
import { Menu } from '../../../../icons';
import { IconButton } from './IconButton';

/**
 * Render the players count.
 */
export const Players = React.memo(
    (props: {
        count?: number;
        maxCount?: number;
        style?: CSSProperties;
        onMenuClicked: () => void;
    }): React.ReactElement => {
        const { count, maxCount, style, onMenuClicked: onMenuPressed } = props;
        const playersText = isMobile ? `${count}/${maxCount}` : `Players (${count}/${maxCount})`;

        return (
            <Container
                style={{
                    ...styles.players,
                    ...style,
                }}
            >
                <Text style={styles.playersText}>{playersText}</Text>
                <Inline size="xs" />
                <IconButton
                    icon={Menu}
                    style={{
                        ...styles.menuButton,
                        ...(isMobile ? { width: 40, height: 40 } : {}),
                    }}
                    onClick={onMenuPressed}
                />
            </Container>
        );
    },
);

const styles: { [key: string]: CSSProperties } = {
    players: {
        flexDirection: 'row',
        pointerEvents: 'all',
    },
    playersText: {
        color: 'white',
        fontSize: isMobile ? 14 : 16,
    },
    menuButton: {},
};

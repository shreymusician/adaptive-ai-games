import { Constants } from '@tosios/common';
import React from 'react';
import { Helmet } from 'react-helmet';
import { Space, Text, View } from '../../../components';
import { titleImage } from '../../../images';

export function Header(): React.ReactElement {
    return (
        <>
            <Helmet>
                <title>{`${Constants.APP_TITLE} - Home`}</title>
                <meta
                    name="description"
                    content="The Open-Source IO Shooter is an open-source multiplayer game in the browser meant to be hostable, modifiable, and playable by anyone."
                />
            </Helmet>

            <View
                flex
                center
                column
                style={{
                    width: 700,
                    maxWidth: '100%',
                }}
            >
                <img alt="TOSIOS" src={titleImage} />
                <Space size="xs" />
                <Text style={{ color: 'white', fontSize: 13 }}>
                    An open-source multiplayer game in the browser meant to be hostable, modifiable, and playable by
                    anyone.
                </Text>
                <Space size="xxs" />
            </View>
        </>
    );
}

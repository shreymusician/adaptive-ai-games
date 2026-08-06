import React from 'react';
import { version } from '../../../../../../package.json';
import { Inline, View } from '../../../components';
import { Text } from '../../../components/Text';
import { GitHubIcon } from '../../../icons';

const URL = 'https://github.com/halftheopposite/tosios';

export function Footer(): React.ReactElement {
    return (
        <a href={URL}>
            <View
                flex
                center
                style={{
                    color: 'white',
                    fontSize: 14,
                }}
            >
                <GitHubIcon />
                <Inline size="xxs" />
                <Text>GitHub (v{version})</Text>
            </View>
        </a>
    );
}

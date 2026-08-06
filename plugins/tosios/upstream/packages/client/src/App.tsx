import { LocationProvider, Router } from '@reach/router';
import React from 'react';
import { GameScreen } from './screens/Game/Game';
import { HomeScreen } from './screens/Home/Home';

export default function App(): React.ReactElement {
    return (
        <LocationProvider>
            <RoutedApp />
        </LocationProvider>
    );
}

function RoutedApp(): React.ReactElement {
    return (
        <Router>
            <HomeScreen default path="/" />
            <GameScreen path="/:roomId" />
        </Router>
    );
}

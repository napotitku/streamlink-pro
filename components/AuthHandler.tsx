import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Catch-all route: sends unknown paths back to the dashboard.
 * (Twitch's login redirect lands on `/?code=…`, which `useTwitchAuth` handles.)
 */
const AuthHandler: React.FC = () => {
    const navigate = useNavigate();
    useEffect(() => { navigate('/', { replace: true }); }, [navigate]);
    return null;
};

export default AuthHandler;

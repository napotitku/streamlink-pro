import { useEffect, useState } from 'react';

/** Current time in ms, re-rendering every `intervalMs` while `enabled`. For countdowns. */
export const useNow = (intervalMs = 1000, enabled = true): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!enabled) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs, enabled]);
    return now;
};

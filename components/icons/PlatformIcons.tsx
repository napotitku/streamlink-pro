import React from 'react';

interface IconProps {
    className?: string;
}

/**
 * Official Twitch glitch logo SVG.
 * Use `className` to control size and colour (fill-current by default).
 */
export const TwitchIcon: React.FC<IconProps> = ({ className = 'w-4 h-4 fill-current' }) => (
    <svg className={className} viewBox="0 0 24 24" aria-label="Twitch">
        <path d="M11.571 4.714h1.715v5.143H11.57V4.714zm4.715 0H18v5.143h-1.714V4.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0H6zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714v9.429z" />
    </svg>
);

/**
 * Official YouTube play-button icon SVG.
 *
 * Per YouTube Branding Guidelines (https://developers.google.com/youtube/terms/branding-guidelines):
 *  - Outer shape: YouTube Red (#FF0000) — DO NOT change
 *  - Play triangle: white (#FFFFFF) — DO NOT change
 *  - Use `className` for sizing only (e.g. "w-4 h-4"). Never pass fill/color classes.
 */
export const YouTubeIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
    <svg className={className} viewBox="0 0 24 24" aria-label="YouTube" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
            fill="#FF0000"
        />
        <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF" />
    </svg>
);

/**
 * Kocouří díra's mark: the cat's head with its lightning bolt cut out, one colour, no background
 * (kocouri-dira's public/logo.svg). Filled with the text colour; on a tile its brand colours are
 * honey (#f3ae38) on dark rust (#521a00).
 */
export const KocouriIcon: React.FC<IconProps> = ({ className = 'w-4 h-4 fill-current' }) => (
    <svg className={className} viewBox="1 0 1458.333 1458.333" aria-label="Kocouří díra">
        <path fillRule="evenodd" d="M1415.048,478.345C1443.697,556.551 1459.333,641.033 1459.333,729.167C1459.333,1131.875 1132.875,1458.333 730.167,1458.333C327.458,1458.333 1,1131.875 1,729.167C1,641.033 16.636,556.551 45.286,478.345C44.961,477.404 -38.945,233.852 28.399,42.385C39.203,11.668 71.516,-6.065 103.082,1.906C252.558,39.647 345.86,106.511 347.999,108.054C459.126,39.532 590.029,0 730.167,0C870.304,0 1001.208,39.532 1112.334,108.054C1114.474,106.511 1207.776,39.647 1357.251,1.906C1388.817,-6.065 1421.13,11.668 1431.934,42.385C1499.279,233.852 1415.372,477.405 1415.048,478.345ZM774.18,324.277C759.372,282.57 713.541,260.78 671.844,275.581L671.84,275.582C630.132,290.395 608.333,336.21 623.14,377.919L716.389,640.479L632.098,636.847L631.978,636.842C607.469,635.901 583.612,646.181 567.623,664.962L567.62,664.966C551.617,683.773 545.172,708.913 550.154,733.099L550.155,733.107L630.673,1123.434C638.497,1161.316 671.876,1187.384 709.104,1187.384C714.457,1187.384 719.902,1186.848 725.353,1185.723L725.358,1185.723C768.7,1176.774 796.596,1134.397 787.653,1091.043L727.906,801.41L828.234,805.74L828.478,805.749C854.979,806.64 880.353,794.662 896.137,773.3C911.977,751.871 916.123,723.967 907.211,698.854L774.18,324.277Z" />
    </svg>
);

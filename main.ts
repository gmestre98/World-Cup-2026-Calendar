import axios from 'axios';
import { google, calendar_v3 } from 'googleapis';
import { createHash } from 'crypto';

const SERVICE_ACCOUNT_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const publicCalendarId = process.env.PUBLIC_CALENDAR_ID || 'primary';
const portugalCalendarId = process.env.PORTUGAL_CALENDAR_ID;

interface ProcessedGame {
    title: string;
    location: string;
    competition: string;
    utcStart: string;
    idString: string;
    group?: string;
}

interface OpenFootballTeam {
    name: string;
}

interface OpenFootballStadium {
    name: string;
}

interface OpenFootballMatch {
    date: string;
    time?: string;
    team1?: string | OpenFootballTeam;
    team2?: string | OpenFootballTeam;
    stadium?: OpenFootballStadium;
    venue?: string;
    group?: string;
    ground?: string;
    round?: string;
}

interface OpenFootballRound {
    name?: string;
    matches?: OpenFootballMatch[];
}

interface OpenFootballResponse {
    rounds?: OpenFootballRound[];
    matches?: OpenFootballMatch[];
}

const countryCalendarIds: Record<string, string | undefined> = {
    'Portugal': process.env.PORTUGAL_CALENDAR_ID,
    'Norway': process.env.NORWAY_CALENDAR_ID,
    'Argentina': process.env.ARGENTINA_CALENDAR_ID,
    'Colombia': process.env.COLOMBIA_CALENDAR_ID,
    'Cape Verde': process.env.CAPEVERDE_CALENDAR_ID,
    'Bosnia & Herzegovina': process.env.BOSNIA_CALENDAR_ID,
    'Belgium': process.env.BELGIUM_CALENDAR_ID,
    'Germany': process.env.GERMANY_CALENDAR_ID,
};

const gameOverrides: Record<
    string,
    {
        matchTitle?: string;
        location?: string;
        competition?: string;
        group?: string;
    }
> = {
    // Example
    //'wc2026-m-83': { matchTitle: '🇵🇹 Portugal vs 🇪🇸 Spain'},
};

const countryFlagMap: Record<string, string> = {
    'Algeria': '🇩🇿',
    'Argentina': '🇦🇷',
    'Australia': '🇦🇺',
    'Austria': '🇦🇹',
    'Belgium': '🇧🇪',
    'Bosnia & Herzegovina': '🇧🇦',
    'Brazil': '🇧🇷',
    'Canada': '🇨🇦',
    'Cape Verde': '🇨🇻',
    'Colombia': '🇨🇴',
    'Costa Rica': '🇨🇷',
    'Croatia': '🇭🇷',
    'Cuba': '🇨🇺',
    'Curaçao': '🇨🇼',
    'Czech Republic': '🇨🇿',
    'DR Congo': '🇨🇩',
    'Ecuador': '🇪🇨',
    'Egypt': '🇪🇬',
    'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'France': '🇫🇷',
    'Germany': '🇩🇪',
    'Ghana': '🇬🇭',
    'Haiti': '🇭🇹',
    'Iraq': '🇮🇶',
    'Iran': '🇮🇷',
    'Ireland': '🇮🇪',
    'Israel': '🇮🇱',
    'Ivory Coast': '🇨🇮',
    'Japan': '🇯🇵',
    'Jordan': '🇯🇴',
    'Mexico': '🇲🇽',
    'Morocco': '🇲🇦',
    'Netherlands': '🇳🇱',
    'New Zealand': '🇳🇿',
    'Norway': '🇳🇴',
    'Panama': '🇵🇦',
    'Paraguay': '🇵🇾',
    'Portugal': '🇵🇹',
    'Qatar': '🇶🇦',
    'Saudi Arabia': '🇸🇦',
    'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'Senegal': '🇸🇳',
    'South Africa': '🇿🇦',
    'South Korea': '🇰🇷',
    'Spain': '🇪🇸',
    'Sweden': '🇸🇪',
    'Switzerland': '🇨🇭',
    'Tunisia': '🇹🇳',
    'Turkey': '🇹🇷',
    'Uganda': '🇺🇬',
    'Uruguay': '🇺🇾',
    'USA': '🇺🇸',
    'Uzbekistan': '🇺🇿',
};

function getFlagForCountry(country: string): string {
    const normalized = country.trim();
    return countryFlagMap[normalized] || '';
}

function formatTeamName(team: string | OpenFootballTeam | undefined): string {
    const name = typeof team === 'object' ? team.name : team || 'TBD';
    const flag = getFlagForCountry(name);
    return flag ? `${flag} ${name}` : name;
}

function buildUtcStart(date: string, time: string): string {
    const rawTime = time.trim();
    const offsetMatch = rawTime.match(/^(\d{1,2}:\d{2})(?:\s+)?UTC([+-])(\d{1,2})$/i);

    if (offsetMatch) {
        const hourMinute = offsetMatch[1];
        const sign = offsetMatch[2];
        const offsetHours = offsetMatch[3].padStart(2, '0');
        const isoTimestamp = `${date}T${hourMinute}:00${sign}${offsetHours}:00`;
        const parsed = new Date(isoTimestamp);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }

    const fallbackTimestamp = `${date}T${rawTime.slice(0, 5)}:00Z`;
    return new Date(fallbackTimestamp).toISOString();
}

async function fetchWorldCupGamesFromUrl(): Promise<ProcessedGame[]> {
    const targetRawUrl = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

    try {
        console.log(`Connecting to: ${targetRawUrl}`);
        const response = await axios.get<OpenFootballResponse>(targetRawUrl);
        const gamesList: ProcessedGame[] = [];
        const rounds = response.data.rounds || [];
        const matches = response.data.matches || [];

        let localMatchIndex = 1;

        const processMatch = (match: OpenFootballMatch, roundName?: string) => {
            if (!match.date) return;

            const homeTeam = formatTeamName(match.team1);
            const awayTeam = formatTeamName(match.team2);
            const defaultTitle = `${homeTeam} vs ${awayTeam}`;
            const matchGroup = match.group?.trim();
            const group = matchGroup ? matchGroup : undefined;
            const venue = match.ground || match.stadium?.name || match.venue || 'TBD Stadium';
            const competition = `FIFA World Cup 2026 - ${match.round || roundName || 'Match'}`;
            const timeString = match.time || '18:00';
            const utcStart = buildUtcStart(match.date, timeString);
            const idString = `wc2026-m-${localMatchIndex++}`;

            const override = gameOverrides[idString];

            gamesList.push({
                title: override?.matchTitle ?? defaultTitle,
                location: override?.location ?? venue,
                competition: override?.competition ?? competition,
                utcStart,
                idString,
                group: override?.group ?? group,
            });
        };

        if (matches.length > 0) {
            for (const match of matches) {
                processMatch(match);
            }
        } else {
            for (const round of rounds) {
                const roundName = round.name || 'Tournament Match';
                const roundMatches = round.matches || [];
                for (const match of roundMatches) {
                    processMatch(match, roundName);
                }
            }
        }

        return gamesList;
    } catch (error: any) {
        console.error('Error streaming raw data package from GitHub:', error.message);
        return [];
    }
}

async function initializeCalendarService(): Promise<calendar_v3.Calendar> {
    const auth = new google.auth.GoogleAuth({
        credentials: SERVICE_ACCOUNT_JSON ? JSON.parse(SERVICE_ACCOUNT_JSON) : undefined,
        keyFile: SERVICE_ACCOUNT_JSON ? undefined : SERVICE_ACCOUNT_FILE,
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    return google.calendar({ version: 'v3', auth });
}

function isSpecificCountryGame(game: ProcessedGame, country: string): boolean {
    return game.title.includes(country);
}

async function insertGameInCalendar(game: ProcessedGame, calendarService: calendar_v3.Calendar): Promise<void> {
    const startTime = new Date(game.utcStart);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
    const gameId = createHash('sha256').update(game.idString).digest('hex');

    const eventBody: calendar_v3.Schema$Event = {
        summary: game.title,
        location: game.location,
        description: game.competition + (game.group ? `\n${game.group}` : ''),
        id: gameId,
        start: {
            dateTime: startTime.toISOString(),
            timeZone: 'UTC',
        },
        end: {
            dateTime: endTime.toISOString(),
            timeZone: 'UTC',
        },
    };

    await insertOrUpdateEvent(calendarService, publicCalendarId, gameId, game, eventBody);

    for (const [country, calendarID] of Object.entries(countryCalendarIds)) {
        if (calendarID && isSpecificCountryGame(game, country)) {
            await insertOrUpdateEvent(calendarService, calendarID, gameId, game, eventBody);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertOrUpdateEvent(
    calendarService: calendar_v3.Calendar,
    calendarId: string,
    gameId: string,
    game: ProcessedGame,
    eventBody: calendar_v3.Schema$Event
): Promise<void> {
    try {
        await calendarService.events.insert({
            calendarId,
            requestBody: eventBody,
        });
        console.log(`[CREATED] ${game.title} in ${calendarId}`);
    } catch (err: any) {
        if (err.status === 409) {
            try {
                const existingEvent = await calendarService.events.get({
                    calendarId,
                    eventId: gameId,
                });

                const timeChanged = existingEvent.data.start?.dateTime !== eventBody.start?.dateTime;
                const teamsChanged = existingEvent.data.summary !== game.title;

                if (teamsChanged || timeChanged) {
                    await calendarService.events.update({
                        calendarId,
                        eventId: gameId,
                        requestBody: eventBody,
                    });
                    console.log(`[UPDATED] ${existingEvent.data.summary} -> ${game.title} in ${calendarId}`);
                    await sleep(100); // brief pause to respect API limits
                } else {
                    console.log(`[NO CHANGE] ${game.title} in ${calendarId}`);
                }
            } catch (updateErr: any) {
                console.error(`Error updating event in ${calendarId}:`, updateErr.message);
            }
        } else {
            console.error(`API execution anomaly for ${game.title} in ${calendarId}:`, err.message);
        }
    }
}

async function main(): Promise<void> {
    const gamesList = await fetchWorldCupGamesFromUrl();

    if (gamesList.length === 0) {
        console.log('No structural match map items returned.');
        return;
    }

    console.log(`Successfully mapped ${gamesList.length} matches from GitHub. Processing calendar context...`);
    const calendarService: calendar_v3.Calendar = await initializeCalendarService();

    for (const game of gamesList) {
        if (game.utcStart && !game.utcStart.includes('NaN')) {
            await insertGameInCalendar(game, calendarService);
        }
    }
    console.log('Sync sequence completed successfully!');
}

main();
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
    'Uzbekistan': '🇺🇿'
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
    const targetRawUrl = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
    
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
            const title = `${homeTeam} vs ${awayTeam}`;
            const group = match.group ? `Group ${match.group.trim()}` : undefined;
            const venue = match.ground || match.stadium?.name || match.venue || 'TBD Stadium';
            const competition = `FIFA World Cup 2026 - ${match.round || roundName || "Match"}`;
            const timeString = match.time || "18:00";
            const utcStart = buildUtcStart(match.date, timeString);
            const idString = `wc2026-m-${localMatchIndex++}`;

            gamesList.push({
                title,
                location: venue,
                competition,
                utcStart,
                idString,
                group,
            });
        };

        if (matches.length > 0) {
            for (const match of matches) {
                processMatch(match);
            }
        } else {
            for (const round of rounds) {
                const roundName = round.name || "Tournament Match";
                const roundMatches = round.matches || [];
                for (const match of roundMatches) {
                    processMatch(match, roundName);
                }
            }
        }

        return gamesList;
    } catch (error: any) {
        console.error("Error streaming raw data package from GitHub:", error.message);
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

function isPortugalGame(game: ProcessedGame): boolean {
    return game.title.includes('🇵🇹');
}

async function insertGameInCalendar(game: ProcessedGame, calendarService: calendar_v3.Calendar): Promise<void> {
    const startTime: Date = new Date(game.utcStart);
    const endTime: Date = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

    const gameId: string = createHash('sha256').update(game.idString).digest('hex');

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
        }
    };

    // Insert into main calendar
    await insertOrUpdateEvent(calendarService, publicCalendarId, gameId, game, eventBody);

    // Insert into Portugal-specific calendar if applicable
    if (isPortugalGame(game) && portugalCalendarId) {
        await insertOrUpdateEvent(calendarService, portugalCalendarId, gameId, game, eventBody);
    }
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

                const timeChanged: boolean = existingEvent.data.start?.dateTime !== eventBody.start?.dateTime;
                const teamsChanged: boolean = existingEvent.data.summary !== game.title;

                if (teamsChanged || timeChanged) {
                    await calendarService.events.update({
                        calendarId,
                        eventId: gameId,
                        requestBody: eventBody,
                    });
                    console.log(`[UPDATED] ${existingEvent.data.summary} -> ${game.title} in ${calendarId}`);
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
        console.log("No structural match map items returned.");
        return;
    }
    
    console.log(`Successfully mapped ${gamesList.length} matches from GitHub. Processing calendar context...`);
    const calendarService: calendar_v3.Calendar = await initializeCalendarService();
    
    for (const game of gamesList) {
        if (game.utcStart && !game.utcStart.includes('NaN')) {
            await insertGameInCalendar(game, calendarService);
        }
    }
    console.log("Sync sequence completed successfully!");
}

main();
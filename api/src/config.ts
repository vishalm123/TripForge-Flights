// creating custom types for logLevel as it can be of anything from 'debug' | 'info' | 'warn' | 'error'
export type logLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig{
    databaseUrl: string;
    port: number;
    logLevel: logLevel;
    dbStatementTimeoutMs: number;
}

// Helper to parse and validate numbers from env strings
function parseNumberEnv(
    value: string | undefined,
    fallback: number,
    name: string,
    min: number,
    max: number,

): number {
    if (!value) return fallback;

    // 2. Only plain digits allowed (rejects " ", "-1", "3.5", "0x10", "Infinity")
    if (!/^\d+$/.test(value)) {
        throw new Error(`${name} must be an integer between ${min} and ${max}, got "${value}"`);
    }
    
    // Convert
    const parsed = Number(value);

    if (parsed < min || parsed > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}, got "${value}"`);
    }

    return parsed;
}

// exporting the loadConfig function 
export function loadConfig(): AppConfig {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('Missing required environment variable: DATABASE_URL');
    }

    const validLogLevels: logLevel[] = ['debug', 'info', 'warn', 'error'];
    const rawLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as logLevel;
    
    if (!validLogLevels.includes(rawLogLevel)) {
        throw new Error(`Invalid LOG_LEVEL: "${rawLogLevel}". Must be one of: ${validLogLevels.join(', ')}`);
    }

    return {
        databaseUrl,
        port: parseNumberEnv(process.env.PORT, 3001, 'PORT', 1, 65535),
        logLevel: rawLogLevel,
        dbStatementTimeoutMs: parseNumberEnv(process.env.DB_STATEMENT_TIMEOUT_MS, 5000, 'DB_STATEMENT_TIMEOUT_MS', 1, 60000),
    };
    
}
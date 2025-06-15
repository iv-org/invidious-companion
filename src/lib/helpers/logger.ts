export enum LogLevel {
    "all" = 0,
    "trace" = 1,
    "debug" = 2,
    "info" = 3,
    "warn" = 4,
    "error" = 5,
    "fatal" = 6,
    "off" = 7,
}

export class Logger {
    logLevel: LogLevel;
    colorize: boolean;

    constructor(log_level: string, colorize_logs: boolean) {
        this.logLevel = LogLevel.info;
        this.colorize = colorize_logs;
        // Sets the log level depending of the value of `config.log_level`
        const configLogLevel = log_level.toLowerCase();
        if (Object.values(LogLevel).includes(configLogLevel)) {
            this.logLevel = Object.values(LogLevel).indexOf(configLogLevel);
        }
        console.log(this.logLevel);
    }

    private log(level: LogLevel, msg: string | undefined, err?: object | undefined) {
        if (level >= this.logLevel) {
            const levelName = LogLevel[level].toUpperCase();
            const date = new Date().toISOString();
            if (typeof err === 'undefined') {
                console.log(`[${date}] ${levelName}: ${msg}`);
            } else if (typeof msg === 'undefined') {
                console.log(`[${date}] ${levelName}:`, err);
            } else {
                console.log(`[${date}] ${levelName}: ${msg}`, err);
            }
        }
    }

    public trace(msg: string) {
        this.log(LogLevel.trace, msg);
    }

    public debug(msg: string) {
        this.log(LogLevel.debug, msg);
    }

    public info(msg: string) {
        this.log(LogLevel.info, msg);
    }

    public warn(msg: string | undefined, err?: object | undefined) {
        this.log(LogLevel.warn, msg, err);
    }

    public error(msg: string | undefined, err?: object | undefined) {
        this.log(LogLevel.error, msg, err);
    }

    public fatal(msg: string | undefined, err?: object | undefined) {
        this.log(LogLevel.fatal, msg, err);
    }
}

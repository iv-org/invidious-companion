export interface RetryOptions {
    maxAttempts: number;
    minTimeout: number;
    maxTimeout?: number;
    multiplier: number;
    jitter: number;
}

export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
): Promise<T> {
    const {
        maxAttempts,
        minTimeout,
        maxTimeout = Number.MAX_SAFE_INTEGER,
        multiplier,
        jitter,
    } = options;

    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            attempt++;
            if (attempt >= maxAttempts) {
                throw error;
            }
            const timeout = Math.min(
                minTimeout * multiplier ** (attempt - 1),
                maxTimeout,
            );
            const jittered = jitter
                ? timeout * (1 + Math.random() * jitter)
                : timeout;
            await new Promise((resolve) => setTimeout(resolve, jittered));
        }
    }
}

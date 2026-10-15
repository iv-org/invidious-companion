import nodeAssert from "node:assert";

export function assert(value: unknown, message?: string): asserts value {
    nodeAssert(value, message);
}

export function assertEquals<T>(
    actual: T,
    expected: T,
    message?: string,
): void {
    nodeAssert.deepStrictEqual(actual, expected, message);
}

export function assertThrows(
    fn: () => unknown,
    ErrorClass: new(...args: never[]) => Error,
    msgIncludes?: string,
): void {
    nodeAssert.throws(fn, (err) => {
        if (!(err instanceof ErrorClass)) return false;
        if (msgIncludes !== undefined && !err.message.includes(msgIncludes)) {
            return false;
        }
        return true;
    });
}

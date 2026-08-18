
type HTTPExceptionOptions = {
    res?: Response
    message?: string
    cause?: unknown
}

// Throw this from a handler or middleware when you want to bail out
// with a specific status code, e.g. `throw new HTTPException(404, { message: "not found" })`.
// main.ts catches it in handleError() and turns it into a real Response.
export class HTTPException extends Error {
    readonly res?: Response
    readonly status: number

    /**
     * @param status - http status code to respond with, defaults to 500
     * @param options - either a custom `res` to send as-is, or a `message` (and optional `cause`)
     */
    constructor(status: number = 500, options?: HTTPExceptionOptions) {
        super(options?.message, { cause: options?.cause })
        this.name = 'HTTPException'
        this.res = options?.res
        this.status = status
    }

    /**
     * Turns this exception into an actual Response. Uses the custom
     * `res` if one was given, otherwise builds a plain response from
     * the message and status.
     *
     * @returns a Response with this exception's status
     */
    getResponse(): Response {
        if (this.res) {
            const newResponse = new Response(this.res.body, {
                status: this.status,
                headers: this.res.headers,
            })
            return newResponse
        }
        return new Response(this.message, {
            status: this.status,
        })
    }

}
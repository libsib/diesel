
type HTTPExceptionOptions = {
    res?: Response
    message?: string
    cause?: unknown
}

export class HTTPException extends Error {
    readonly res?: Response
    readonly status: number

    constructor(status: number = 500, options?: HTTPExceptionOptions) {
        super(options?.message, { cause: options?.cause })
        this.name = 'HTTPException'
        this.res = options?.res
        this.status = status
    }

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
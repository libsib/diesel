import * as http from 'node:http'
import { connInfo, type ConnInfo } from './conninfo'

export { connInfo, type ConnInfo }

export interface options {
    fetch: (req: Request, ...args: any) => Response | Promise<Response>
    port: number
}

async function convertNodeReqToWebReq(req: http.IncomingMessage) {
    const protocol = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || 'http';
    const url = `${protocol}://${req.headers.host}${req.url}`;

    const init: RequestInit = {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: null
    }
    if (req.method !== 'GET' && req.method !== 'PUT') {
        init.body = new ReadableStream({
            start(controller) {
                req.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
                req.on('end', () => controller.close());
                req.on('error', (err) => controller.error(err));
            }
        });
    }
    return new Request(url, init);
}



async function sendWebResToNodeRes(webRes: Response, nodeRes: http.ServerResponse) {
    nodeRes.writeHead(webRes.status, Object.fromEntries(webRes.headers))
    const reader = webRes.body?.getReader()
    if (reader) {
        let result
        while (!(result = await reader.read()).done) {
            nodeRes.write(Buffer.from(result.value))
        }
    }
    nodeRes.end()
}

export function serve(options: options): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> {
    const server = http.createServer(async (request, response) => {
        const webRequest = await convertNodeReqToWebReq(request);

        // send our req to diesel's fetch handler

        const webRes = await options.fetch(webRequest, server as any)
        await sendWebResToNodeRes(webRes, response)
    })

    server.listen(options.port ?? 3000, () => console.log(`node server running on port ${options.port ?? 3000}`))
    return server;
}



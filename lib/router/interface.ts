import { TrieRouter } from "./trie.js";
import { TrieRouter as PeepalTrieRouter } from "peepal-router";


export interface Router {
    add(method: string, path: string, handler: Function | Function[]): void
    find(method: string, path: string): Find
    addMiddleware(path: string, handlers: Function | Function[]): void
}

export interface Find {
    params: Record<string, string> | undefined;
    middlewares: Function[] | undefined;
    handler: Array<Function> | undefined;
}

export class PeepalRouter implements Router {
    private router: PeepalTrieRouter;

    constructor() {
        this.router = new PeepalTrieRouter();
    }

    add(method: string, path: string, handler: Function | Function[]): void {
        this.router.add(method, path, handler);
    }

    addMiddleware(path: string, handlers: Function | Function[]): void {
        this.router.addMiddleware(path, handlers);
    }

    find(method: string, path: string): Find {
        const result = this.router.search(method, path);
        return {
            params: result.params,
            middlewares: result.middlewares,
            handler: result.handler,
        };
    }
}

export class RouterFactory {
    static create(name?: string): Router {
        switch (name) {
            case 't2':
                return new TrieRouter()
            case 'trie':
                return new TrieRouter()
            case 'peepal':
                return new PeepalRouter()
            default: return new PeepalRouter()
        }
    }
}
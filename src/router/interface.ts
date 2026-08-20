import { TrieRouter } from "./trie.js";
import { TrieRouter as PeepalTrieRouter } from "peepal-router";


// any router diesel uses (our own trie router, or the peepal one) has
// to implement this. Diesel only ever talks to routers through this interface.
export interface Router {
    add(method: string, path: string, handler: Function | Function[]): void
    find(method: string, path: string): Find
    addMiddleware(path: string, handlers: Function | Function[]): void
}

// what you get back from router.find()
export interface Find {
    params: Record<string, string> | undefined;
    middlewares: Function[] | undefined;
    handler: Array<Function> | undefined;
}

// Router implementation backed by the `peepal-router` package instead
// of our own trie router, just adapts its shape to our Router interface.
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
        return this.router.search(method, path);
    }
}

// picks which router implementation to use, based on the `router`
// option passed to `new Diesel({ router: "..." })`. Defaults to
// peepal-router if you pass nothing or an unknown name - our own
// trie router (src/router/trie.ts) is still available via 'trie'/'t2'.
export class RouterFactory {
    static create(name?: string): Router {
        switch (name) {
            case 't2':
                return new TrieRouter()
            case 'trie':
                return new TrieRouter()
            case 'peepal':
                return new PeepalRouter();
            default: return new PeepalRouter()
        }
    }
}
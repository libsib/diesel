export interface RateLimitStore{
    get(key:string): Promise<number | null>;
    set(key:string, value:string, ttlMs:number): Promise<void>
    reset(key:string): Promise<void>
    // Atomically increments `key` and returns the new count. The TTL must
    // only be set when the key is created (count === 1), so the window
    // expires instead of sliding on every hit. Optional for backward
    // compat; stores without it fall back to get/set, which can race.
    incr?(key:string, ttlMs:number): Promise<number>
}

class RedisStore implements RateLimitStore{
    constructor(private redis:any){

    }

    async get(key:string){
        const value = await this.redis.get(key)
        return value ? parseInt(value) : null
    }

    async set(key:string, value:string, ttlMs:number){
        await this.redis.set(key,value,'PX',ttlMs)
    }

    async incr(key:string, ttlMs:number){
        const count = Number(await this.redis.incr(key))
        if (count === 1) {
            await this.redis.pexpire(key, ttlMs)
        }
        return count
    }

    async reset(key:string){
        await this.redis.del(key)
    }

}



export {
    RedisStore,
}

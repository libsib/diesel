import path from "path";
import * as fs from "fs";
import { ContextType } from "../../types";

// Replace fileURLToPath usage with Bun's import.meta.dir
const __dirname = import.meta.dir;

const defaultUploadDir = path.resolve(__dirname, "../../public/uploaded");



if (!fs.existsSync(defaultUploadDir)) {
    fs.mkdirSync(defaultUploadDir, { recursive: true });
}

export const fileSaveMiddleware = (options: { dest?: string, fields?: string[] } = {}) => {
    const uploadDir = options.dest ? path.resolve(__dirname, options.dest) : defaultUploadDir;

    return async (ctx:ContextType) => {
        try {
            const body = await ctx.body
            ctx.req.files ??= {};
            
            for ( const field of options?.fields ?? []){
                const file = body[field]
                if (!file.name) continue;
                
                const filename = `${field}_${crypto.randomUUID()}${path.extname(file?.name)}`
                const savefilepath = path.join(uploadDir,filename)

                await Bun.write(savefilepath, await file.arrayBuffer())
                ctx.req.files[field] = savefilepath
            }
        } catch (error) {
            console.error("File upload error:", error);
            return ctx.json({ status: 500, message: "Error uploading files" }, 500);
        }
    }
};

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { ContextType } from "../../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

                await fs.promises.writeFile(savefilepath, Buffer.from(await file.arrayBuffer()))
                ctx.req.files[field] = savefilepath
            }
        } catch (error) {
            console.error("File upload error:", error);
            return ctx.json({ status: 500, message: "Error uploading files" }, 500);
        }
    }
};

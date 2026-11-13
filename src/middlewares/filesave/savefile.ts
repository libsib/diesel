import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { ContextType } from "../../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultUploadDir = path.resolve(__dirname, "../../public/uploaded");

if (!fs.existsSync(defaultUploadDir)) {
    fs.mkdirSync(defaultUploadDir, { recursive: true });
}

export interface FileSaveOptions {
    /** Destination directory, resolved relative to this module. Defaults to public/uploaded. */
    dest?: string;
    /** Form fields to pull files from. */
    fields?: string[];
    /** Max size per file in bytes. Files larger than this are rejected with 413. */
    maxFileSize?: number;
    /** Whitelist of allowed extensions, e.g. [".png", ".jpg"]. Case-insensitive. */
    allowedExtensions?: string[];
    /** Whitelist of allowed MIME types, e.g. ["image/png"]. Case-insensitive. */
    allowedMimeTypes?: string[];
}

export const fileSaveMiddleware = (options: FileSaveOptions = {}) => {
    const uploadDir = options.dest
        ? path.resolve(__dirname, options.dest)
        : defaultUploadDir;

    // Normalise whitelists once, lower-cased for case-insensitive matching.
    const allowedExtensions = options.allowedExtensions?.map((e) =>
        (e.startsWith(".") ? e : `.${e}`).toLowerCase(),
    );
    const allowedMimeTypes = options.allowedMimeTypes?.map((m) =>
        m.toLowerCase(),
    );
    const maxFileSize = options.maxFileSize;

    return async (ctx: ContextType) => {
        try {
            const body = await ctx.body;
            ctx.req.files ??= {};

            for (const field of options?.fields ?? []) {
                const file = body?.[field];
                // Skip missing fields or plain text values (no file was sent).
                if (!file || typeof file === "string" || !file.name) continue;

                // Derive a safe extension from the client name but never trust
                // the name for the path itself — only basename's extension.
                const ext = path.extname(path.basename(file.name)).toLowerCase();

                if (allowedExtensions && !allowedExtensions.includes(ext)) {
                    return ctx.json(
                        { status: 400, message: `File type ${ext || "(none)"} not allowed` },
                        400,
                    );
                }

                if (
                    allowedMimeTypes &&
                    !allowedMimeTypes.includes((file.type || "").toLowerCase())
                ) {
                    return ctx.json(
                        { status: 400, message: `MIME type ${file.type || "(none)"} not allowed` },
                        400,
                    );
                }

                if (maxFileSize !== undefined && file.size > maxFileSize) {
                    return ctx.json(
                        { status: 413, message: `File ${field} exceeds max size of ${maxFileSize} bytes` },
                        413,
                    );
                }

                const filename = `${field}_${crypto.randomUUID()}${ext}`;
                const savefilepath = path.join(uploadDir, filename);

                await fs.promises.writeFile(
                    savefilepath,
                    Buffer.from(await file.arrayBuffer()),
                );
                ctx.req.files[field] = savefilepath;
            }
        } catch (error) {
            console.error("File upload error:", error);
            return ctx.json({ status: 500, message: "Error uploading files" }, 500);
        }
    };
};

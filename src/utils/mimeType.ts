export function getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      // text / web
      case 'js':
      case 'mjs':
        return 'application/javascript';
      case 'ts':
        return 'application/typescript';
      case 'css':
        return 'text/css';
      case 'html':
      case 'htm':
        return 'text/html';
      case 'txt':
        return 'text/plain';
      case 'csv':
        return 'text/csv';
      case 'xml':
        return 'application/xml';
      case 'json':
        return 'application/json';
      case 'md':
        return 'text/markdown';

      // images
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'svg':
        return 'image/svg+xml';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'ico':
        return 'image/x-icon';
      case 'bmp':
        return 'image/bmp';
      case 'avif':
        return 'image/avif';

      // audio / video
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'ogg':
        return 'audio/ogg';
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'mov':
        return 'video/quicktime';
      case 'avi':
        return 'video/x-msvideo';

      // fonts
      case 'woff':
        return 'font/woff';
      case 'woff2':
        return 'font/woff2';
      case 'ttf':
        return 'font/ttf';
      case 'otf':
        return 'font/otf';

      // documents / archives
      case 'pdf':
        return 'application/pdf';
      case 'zip':
        return 'application/zip';
      case 'gz':
        return 'application/gzip';
      case 'tar':
        return 'application/x-tar';
      case 'wasm':
        return 'application/wasm';

      default:
        return 'application/octet-stream';
    }
  }
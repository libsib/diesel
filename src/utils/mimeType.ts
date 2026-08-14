export function getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
        return 'application/javascript';
      case 'css':
        return 'text/css';
      case 'html':
        return 'text/html';
      case 'json':
        return 'application/json';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'svg':
        return 'image/svg+xml';
      case 'gif':
        return 'image/gif';
      case 'woff':
        return 'font/woff';
      case 'woff2':
        return 'font/woff2';
      default:
        return 'application/octet-stream';
    }
  }